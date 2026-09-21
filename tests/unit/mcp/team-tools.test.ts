import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 13 (MCP server, docs/adr/0005) - the two tools that read OTHER
// people's time.
//
// `list_team_members` and `list_team_time_entries` are the only tools on
// the MCP surface that return data about someone other than the caller,
// and the capability scan had neither under any test. The tool
// descriptions promise "only managers and admins may call this; an
// employee asking about a colleague will be refused" - a promise the
// model repeats to the user, so it has to be true.
//
// The failure that matters here is not an error message. It is an
// employee asking Claude "what did Hadas work on last week" and getting
// an answer. That is a privacy breach delivered conversationally, with
// no screen to notice it on and no page view in any log.
//
// So the assertions are about the gate, and about what happens BEHIND
// it: a refused call must not merely hide the result, it must never have
// fetched it. `listTimeEntriesForAdmin` carries no permission check of
// its own - the tool's own `assertCan` is the entire authorisation - so
// "did the query run" is the question with teeth.

const domain = vi.hoisted(() => ({
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  getActiveTimer: vi.fn(),
  updateActiveTimerNote: vi.fn(),
  createManualEntry: vi.fn(),
  listMyTimeEntries: vi.fn(async () => []),
  listTimeEntriesForAdmin: vi.fn(async () => [] as unknown[]),
  combineWallClockTime: vi.fn(),
}));

const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  lookupTeamMember: vi.fn(),
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(async () => [] as unknown[]),
  canSeeOthersTime: vi.fn(() => false),
}));

const tasks = vi.hoisted(() => ({
  listTasks: vi.fn(async () => [] as unknown[]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  assignableUsers: vi.fn(async () => [] as unknown[]),
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS"],
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

// The real shape, not a no-op. Everywhere else in this directory
// `assertCan` is stubbed away because the tool under test is not about
// permissions; here it IS the thing under test, so it has to be able to
// refuse.
const permissions = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(message = "Forbidden") {
      super(message);
      this.name = "ForbiddenError";
    }
  }
  const ALLOWED = new Set(["SUPER_ADMIN", "ANKORA_ADMIN"]);
  return {
    ForbiddenError,
    assertCan: vi.fn((role: string, permission: string) => {
      if (permission === "time_entry.edit_others" && !ALLOWED.has(role)) {
        throw new ForbiddenError(`${role} may not ${permission}`);
      }
    }),
    can: vi.fn(() => false),
  };
});

vi.mock("@/lib/app-domain/time-entries", () => domain);
vi.mock("@/lib/app-domain/tasks", () => tasks);
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/clients", () => ({ listAccessibleClients: vi.fn(async () => []) }));
vi.mock("@/lib/app-auth/permissions", () => permissions);

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[] }>;

function collectTools() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerAnkoraTools({
    registerTool: (name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return tools;
}

const EMPLOYEE = { id: "u-emp", name: "נועה", role: "ANKORA_EMPLOYEE", timezone: "Asia/Jerusalem" };
const ADMIN = { id: "u-adm", name: "Ariel", role: "ANKORA_ADMIN", timezone: "Asia/Jerusalem" };
const CTX = { http: { authInfo: { token: "verified" } } };

function payload(result: { content: { type: string; text: string }[] }) {
  const text = result.content.map((c) => c.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth.actorFromAuthInfo.mockReturnValue(ADMIN);
  tools = collectTools();
});

describe("both team tools are read-only", () => {
  it("never asks a client to confirm before reading, and never claims to write", () => {
    for (const name of ["list_team_members", "list_team_time_entries"]) {
      const ann = tools.get(name)!.config.annotations as { readOnlyHint?: boolean };
      expect(ann.readOnlyHint, name).toBe(true);
    }
  });
});

describe("list_team_members", () => {
  it("returns the roster for an admin", async () => {
    lookup.teamMembers.mockResolvedValue([{ id: "u1", name: "הדס" }, { id: "u2", name: "איתי" }]);

    const out = payload(await tools.get("list_team_members")!.handler({}, CTX));

    expect(out.count).toBe(2);
    expect(lookup.teamMembers).toHaveBeenCalledWith(ADMIN);
  });

  it("refuses an employee, and never reads the roster", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);

    const out = payload(await tools.get("list_team_members")!.handler({}, CTX));

    // The gate has to come BEFORE the read. A tool that fetches and then
    // declines to print has already loaded colleagues' names into a
    // process the caller is not entitled to.
    expect(lookup.teamMembers).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).not.toContain("הדס");
  });
});

describe("list_team_time_entries", () => {
  it("queries the whole team when no person is named", async () => {
    await tools.get("list_team_time_entries")!.handler({}, CTX);

    expect(domain.listTimeEntriesForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined, clientId: undefined }),
    );
  });

  it("refuses an employee asking about a colleague, and runs no query", async () => {
    auth.actorFromAuthInfo.mockReturnValue(EMPLOYEE);

    await tools.get("list_team_time_entries")!.handler({ person: "הדס" }, CTX);

    // listTimeEntriesForAdmin has NO permission check of its own - the
    // assertCan in the tool is the entire authorisation. If it ever stops
    // running first, this tool hands one employee another's whole
    // timesheet, conversationally, with nothing to notice it on.
    expect(domain.listTimeEntriesForAdmin).not.toHaveBeenCalled();
    expect(lookup.lookupTeamMember).not.toHaveBeenCalled();
  });

  it("resolves a person by name rather than taking an id", async () => {
    lookup.lookupTeamMember.mockResolvedValue({ ok: true, value: { id: "u-hadas", name: "הדס" } });

    const out = payload(await tools.get("list_team_time_entries")!.handler({ person: "הדס" }, CTX));

    expect(lookup.lookupTeamMember).toHaveBeenCalledWith(ADMIN, "הדס");
    expect(domain.listTimeEntriesForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-hadas" }),
    );
    expect(out.person).toBe("הדס");
  });

  it("reads nothing when the person does not resolve to exactly one teammate", async () => {
    lookup.lookupTeamMember.mockResolvedValue({ ok: false, message: "Did you mean הדס or הדסה?" });

    const out = payload(await tools.get("list_team_time_entries")!.handler({ person: "הד" }, CTX));

    // Guessing here would attribute one colleague's hours to another.
    expect(domain.listTimeEntriesForAdmin).not.toHaveBeenCalled();
    expect(out.text).toContain("הדס");
  });

  it("reads nothing when the client does not resolve, even though the person did", async () => {
    lookup.lookupTeamMember.mockResolvedValue({ ok: true, value: { id: "u-hadas", name: "הדס" } });
    lookup.lookupClient.mockResolvedValue({ ok: false, message: "ambiguous" });

    await tools.get("list_team_time_entries")!.handler({ person: "הדס", client: "Glob" }, CTX);

    expect(domain.listTimeEntriesForAdmin).not.toHaveBeenCalled();
  });

  it("reads the date window in the actor's timezone, not the server's", async () => {
    await tools.get("list_team_time_entries")!.handler({ from: "2026-09-01", to: "2026-10-01" }, CTX);

    const [args] = domain.listTimeEntriesForAdmin.mock.calls[0] as [
      { from?: Date; to?: Date },
    ];
    // Israeli midnight on 1 September is 21:00 UTC on 31 August (IDT,
    // UTC+3). A UTC-midnight window would silently move three hours of
    // one month's work into the next one's answer.
    expect(args.from?.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(args.to?.toISOString()).toBe("2026-09-30T21:00:00.000Z");
  });

  it("caps the page and says so, rather than quietly truncating", async () => {
    domain.listTimeEntriesForAdmin.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` })),
    );

    const out = payload(await tools.get("list_team_time_entries")!.handler({ limit: 2 }, CTX));

    expect(out.count).toBe(2);
    expect(out.truncated).toBe(true);
    // A model that cannot tell a complete answer from a truncated one
    // will summarise five entries as two and sound certain about it.
    expect(out.totalMatching).toBe(5);
  });

  it("rejects a limit outside the supported range at the schema, not at runtime", () => {
    const schema = tools.get("list_team_time_entries")!.config.inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 10_000 }).success).toBe(false);
    expect(schema.safeParse({ from: "01/09/2026" }).success).toBe(false);
    expect(schema.safeParse({ limit: 50, from: "2026-09-01" }).success).toBe(true);
  });
});
