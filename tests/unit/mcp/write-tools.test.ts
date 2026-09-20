import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 13/14 (MCP server, docs/adr/0005) - the write surface.
//
// Why this file exists: `start_timer`, `create_time_entry`,
// `stop_timer` and `update_timer_note` are the only way into Ankora's
// data that does not go through a browser, and the caller on the other
// end is a language model. The QA capability scan flagged all four as
// having no test that named them at all.
//
// The failure mode that matters is not a crash. It is time booked
// against the wrong client, or against the wrong person, or on the
// wrong day - each of which is plausible, silent, and discovered a
// month later when an invoice is wrong. So every assertion below is
// about one of exactly three properties:
//
//   1. Identity comes from the verified token, never from a tool
//      argument. A model that says `user: "someone else"` gets nowhere.
//   2. A name that does not resolve to exactly one record writes
//      NOTHING. Refusing is the correct behaviour; guessing is not.
//   3. Wall-clock input is interpreted in Ankora's timezone, the same
//      as the manual-entry form, so the same input through either path
//      lands on the same instant.
//
// The domain layer is mocked here on purpose. What is under test is the
// tool surface's own decisions - resolve, refuse, delegate - not the
// behaviour of `startTimer`, which has its own tests.

const domain = vi.hoisted(() => ({
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  getActiveTimer: vi.fn(),
  updateActiveTimerNote: vi.fn(),
  createManualEntry: vi.fn(),
  listMyTimeEntries: vi.fn(),
  listTimeEntriesForAdmin: vi.fn(),
  combineWallClockTime: vi.fn(),
}));

const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  lookupTeamMember: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

vi.mock("@/lib/app-domain/time-entries", () => domain);
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/clients", () => ({ listAccessibleClients: vi.fn(async () => []) }));
vi.mock("@/lib/app-auth/permissions", () => ({ assertCan: vi.fn() }));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[] }>;

/** A stand-in for McpServer that just records what got registered. */
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

const ACTOR = { id: "u-real", name: "Ariel", role: "ANKORA_EMPLOYEE" };
const CTX = { http: { authInfo: { token: "verified" } } };

/** Tool results are JSON in a text block; this is the readable form. */
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
  auth.actorFromAuthInfo.mockReturnValue(ACTOR);
  lookup.canSeeOthersTime.mockReturnValue(false);
  domain.combineWallClockTime.mockImplementation(
    (date: string, time: string) => new Date(`${date}T${time}:00+03:00`),
  );
  tools = collectTools();
});

describe("the write surface is registered at all", () => {
  it("registers every write tool the annotations file declares", () => {
    for (const name of ["start_timer", "stop_timer", "update_timer_note", "create_time_entry"]) {
      expect(tools.has(name), name).toBe(true);
    }
  });

  it("marks each of them as a write, so a client asks before calling", () => {
    for (const name of ["start_timer", "stop_timer", "update_timer_note", "create_time_entry"]) {
      const ann = tools.get(name)!.config.annotations as { readOnlyHint?: boolean };
      expect(ann.readOnlyHint, name).toBe(false);
    }
  });
});

describe("start_timer", () => {
  it("books against the resolved client and records that it came from MCP", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c1", name: "Globex" } });
    lookup.lookupCategory.mockResolvedValue({ ok: true, value: { id: "cat1", name: "Development" } });
    domain.startTimer.mockResolvedValue({ id: "e1", startAt: new Date("2026-09-20T09:00:00Z") });

    const out = payload(
      await tools.get("start_timer")!.handler({ client: "Globex", category: "Development", note: "x" }, CTX),
    );

    expect(out.started).toBe(true);
    expect(domain.startTimer).toHaveBeenCalledWith(ACTOR, {
      clientId: "c1",
      categoryId: "cat1",
      note: "x",
      createdVia: "MCP",
    });
  });

  it("writes nothing when the client name does not resolve", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: false, message: "Did you mean Globex or Globex Industries?" });

    const out = payload(
      await tools.get("start_timer")!.handler({ client: "Glob", category: "Development" }, CTX),
    );

    expect(domain.startTimer).not.toHaveBeenCalled();
    expect(out.text).toContain("Globex");
  });

  it("writes nothing when the category does not resolve, even though the client did", async () => {
    // The dangerous near-miss: the client resolved, so a careless
    // implementation could start the timer and then fail on the category.
    lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c1", name: "Globex" } });
    lookup.lookupCategory.mockResolvedValue({ ok: false, message: "No category by that name for Globex." });

    await tools.get("start_timer")!.handler({ client: "Globex", category: "Dev?" }, CTX);

    expect(domain.startTimer).not.toHaveBeenCalled();
  });

  it("takes the acting user from the token, not from anything the model sent", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c1", name: "Globex" } });
    lookup.lookupCategory.mockResolvedValue({ ok: true, value: { id: "cat1", name: "Development" } });
    domain.startTimer.mockResolvedValue({ id: "e1", startAt: new Date() });

    await tools.get("start_timer")!.handler(
      // A model inventing an actor field is exactly the attempt this guards.
      { client: "Globex", category: "Development", userId: "u-someone-else", user: "Dana" },
      CTX,
    );

    expect(domain.startTimer).toHaveBeenCalledWith(ACTOR, expect.anything());
    expect(lookup.lookupClient).toHaveBeenCalledWith(ACTOR, "Globex");
  });
});

describe("create_time_entry", () => {
  const ARGS = {
    client: "Globex",
    category: "Development",
    date: "2026-09-20",
    start: "09:00",
    end: "11:30",
  };

  beforeEach(() => {
    lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c1", name: "Globex" } });
    lookup.lookupCategory.mockResolvedValue({ ok: true, value: { id: "cat1", name: "Development" } });
    domain.createManualEntry.mockResolvedValue({
      id: "e9",
      startAt: new Date("2026-09-20T06:00:00Z"),
      endAt: new Date("2026-09-20T08:30:00Z"),
    });
  });

  it("interprets the clock through the same helper the manual-entry form uses", async () => {
    await tools.get("create_time_entry")!.handler(ARGS, CTX);

    // Not `new Date("2026-09-20T09:00")`, which would be read in whatever
    // timezone the server process happens to run in (UTC on Vercel) and
    // silently shift every MCP-created entry by two or three hours.
    expect(domain.combineWallClockTime).toHaveBeenCalledWith("2026-09-20", "09:00");
    expect(domain.combineWallClockTime).toHaveBeenCalledWith("2026-09-20", "11:30");
    expect(domain.createManualEntry).toHaveBeenCalled();
  });

  it("refuses an end that is not after the start, and writes nothing", async () => {
    const out = payload(
      await tools.get("create_time_entry")!.handler({ ...ARGS, start: "11:30", end: "09:00" }, CTX),
    );

    expect(domain.createManualEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("09:00");
  });

  it("refuses a zero-length entry rather than recording an empty one", async () => {
    await tools.get("create_time_entry")!.handler({ ...ARGS, start: "09:00", end: "09:00" }, CTX);
    expect(domain.createManualEntry).not.toHaveBeenCalled();
  });

  it("writes nothing when the client does not resolve", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: false, message: "ambiguous" });
    await tools.get("create_time_entry")!.handler(ARGS, CTX);
    expect(domain.createManualEntry).not.toHaveBeenCalled();
  });

  it("requires a date and a clock shape the model cannot improvise around", () => {
    const schema = tools.get("create_time_entry")!.config.inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ ...ARGS, date: "20/09/2026" }).success).toBe(false);
    expect(schema.safeParse({ ...ARGS, start: "9am" }).success).toBe(false);
    expect(schema.safeParse(ARGS).success).toBe(true);
  });
});

describe("update_timer_note", () => {
  it("updates the note on the running timer without stopping it", async () => {
    domain.getActiveTimer.mockResolvedValue({ id: "e5" });

    const out = payload(await tools.get("update_timer_note")!.handler({ note: "refactor" }, CTX));

    expect(domain.updateActiveTimerNote).toHaveBeenCalledWith(ACTOR, "e5", "refactor");
    expect(domain.stopTimer).not.toHaveBeenCalled();
    expect(out.updated).toBe(true);
  });

  it("says so plainly when no timer is running, instead of writing something", async () => {
    domain.getActiveTimer.mockResolvedValue(null);

    const out = payload(await tools.get("update_timer_note")!.handler({ note: "refactor" }, CTX));

    expect(domain.updateActiveTimerNote).not.toHaveBeenCalled();
    expect(out.text).toMatch(/no timer/i);
  });

  it("looks up the running timer for the token's user, not an arbitrary id", async () => {
    domain.getActiveTimer.mockResolvedValue({ id: "e5" });
    await tools.get("update_timer_note")!.handler({ note: "x", entryId: "e-someone-else" }, CTX);
    expect(domain.getActiveTimer).toHaveBeenCalledWith(ACTOR.id);
  });
});

describe("failures do not leak internals to the model", () => {
  it("turns a thrown domain error into a tool failure rather than a stack trace", async () => {
    lookup.lookupClient.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const out = payload(
      await tools.get("start_timer")!.handler({ client: "Globex", category: "Development" }, CTX),
    );

    const text = JSON.stringify(out);
    expect(text).not.toContain("10.0.0.5");
    expect(domain.startTimer).not.toHaveBeenCalled();
  });
});
