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
  // Phase 16 (tasks). These two are separate from lookupTeamMember on
  // purpose - see lib/mcp/lookup.ts on why assigning work is gated more
  // narrowly than reading a colleague's hours.
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));

const tasks = vi.hoisted(() => ({
  listTasks: vi.fn(async () => []),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  assignableUsers: vi.fn(async () => []),
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS"],
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

vi.mock("@/lib/app-domain/time-entries", () => domain);
vi.mock("@/lib/app-domain/tasks", () => tasks);
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
      // Phase 16: an explicit null, not an absent key. A timer started
      // without naming a task must clear the link rather than leave it
      // to whatever the domain layer defaults to.
      taskId: null,
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

// ------------------------------------------------------- Phase 16: tasks
//
// The same three properties as above, asked of the task surface. The one
// that is new here is assignment: a task filed against a colleague who
// cannot see the client is a silent dead letter, so "refuse rather than
// guess" has to hold for the assignee as well as for the client.

describe("create_task", () => {
  beforeEach(() => {
    lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c1", name: "Globex" } });
    tasks.createTask.mockResolvedValue({ id: "t1", title: "Send the report", status: "OPEN" });
  });

  it("opens the task on the resolved client, unassigned and undated by default", async () => {
    const out = payload(
      await tools.get("create_task")!.handler({ client: "Globex", title: "Send the report" }, CTX),
    );

    expect(out.created).toBe(true);
    expect(tasks.createTask).toHaveBeenCalledWith(ACTOR, {
      clientId: "c1",
      categoryId: null,
      title: "Send the report",
      assignedToId: null,
      dueDate: null,
    });
  });

  it("writes nothing when the client does not resolve", async () => {
    lookup.lookupClient.mockResolvedValue({ ok: false, message: "Did you mean Globex Industries?" });
    await tools.get("create_task")!.handler({ client: "Glob", title: "x" }, CTX);
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it("writes nothing when the assignee does not resolve, even though the client did", async () => {
    // The near-miss that matters: creating the task anyway and dropping
    // the assignee would look like success and lose the instruction.
    lookup.lookupAssignee.mockResolvedValue({ ok: false, message: "Two people match Dana." });

    const out = payload(
      await tools.get("create_task")!.handler(
        { client: "Globex", title: "x", assignTo: "Dana" },
        CTX,
      ),
    );

    expect(tasks.createTask).not.toHaveBeenCalled();
    expect(out.text).toContain("Dana");
  });

  it("resolves the assignee against the task's own client, not globally", async () => {
    lookup.lookupAssignee.mockResolvedValue({ ok: true, value: { id: "u2", name: "Dana" } });
    await tools.get("create_task")!.handler({ client: "Globex", title: "x", assignTo: "Dana" }, CTX);
    expect(lookup.lookupAssignee).toHaveBeenCalledWith(ACTOR, "c1", "Dana");
    // Never the admin-only roster lookup - that one asserts a permission
    // most employees do not hold, which would make assignment admin-only.
    expect(lookup.lookupTeamMember).not.toHaveBeenCalled();
  });

  it("stores a due date at the end of that day, not its start", async () => {
    await tools.get("create_task")!.handler({ client: "Globex", title: "x", due: "2026-09-24" }, CTX);

    const { dueDate } = tasks.createTask.mock.calls[0][1] as { dueDate: Date };
    // 23:59 Asia/Jerusalem on the 24th, i.e. still the 24th locally. If
    // this were the START of the day, every task due today would read as
    // overdue from one minute past midnight.
    expect(dueDate.toISOString()).toBe("2026-09-24T20:59:00.000Z");
  });

  it("rejects a due date the model made up a format for", () => {
    const schema = tools.get("create_task")!.config.inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ client: "Globex", title: "x", due: "24/09/2026" }).success).toBe(false);
    expect(schema.safeParse({ client: "Globex", title: "x", due: "2026-09-24" }).success).toBe(true);
  });

  it("takes the acting user from the token, not from anything the model sent", async () => {
    await tools.get("create_task")!.handler(
      { client: "Globex", title: "x", userId: "u-someone-else", createdBy: "Dana" },
      CTX,
    );
    expect(tasks.createTask).toHaveBeenCalledWith(ACTOR, expect.anything());
  });
});

describe("update_task", () => {
  beforeEach(() => {
    lookup.lookupTask.mockResolvedValue({
      ok: true,
      value: { id: "t1", name: "Send the report", clientId: "c1", clientName: "Globex" },
    });
    tasks.updateTask.mockResolvedValue({ id: "t1", title: "Send the report", status: "DONE" });
  });

  it("changes only the fields that were passed", async () => {
    await tools.get("update_task")!.handler({ task: "Send the report", status: "DONE" }, CTX);
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", { status: "DONE" });
  });

  it("writes nothing when the title matches more than one task", async () => {
    // Guessing here would close the wrong piece of work.
    lookup.lookupTask.mockResolvedValue({ ok: false, message: "Two tasks are called that." });

    const out = payload(await tools.get("update_task")!.handler({ task: "report", status: "DONE" }, CTX));

    expect(tasks.updateTask).not.toHaveBeenCalled();
    expect(out.text).toContain("Two tasks");
  });

  it("refuses a patch that says two contradictory things at once", async () => {
    for (const args of [
      { task: "x", assignTo: "Dana", clearAssignee: true },
      { task: "x", due: "2026-09-24", clearDue: true },
    ]) {
      await tools.get("update_task")!.handler(args, CTX);
    }
    expect(tasks.updateTask).not.toHaveBeenCalled();
  });

  it("refuses an empty patch instead of pretending something changed", async () => {
    const out = payload(await tools.get("update_task")!.handler({ task: "Send the report" }, CTX));
    expect(tasks.updateTask).not.toHaveBeenCalled();
    expect(out.text).toMatch(/nothing to change/i);
  });

  it("clears a field with an explicit null, not by omitting it", async () => {
    await tools.get("update_task")!.handler({ task: "x", clearAssignee: true, clearDue: true }, CTX);
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", { assignedToId: null, dueDate: null });
  });

  it("validates a new assignee against the client the task actually sits on", async () => {
    // Not against the optional `client` argument, which is only a
    // disambiguation hint and is absent here.
    lookup.lookupAssignee.mockResolvedValue({ ok: true, value: { id: "u2", name: "Dana" } });
    await tools.get("update_task")!.handler({ task: "Send the report", assignTo: "Dana" }, CTX);
    expect(lookup.lookupAssignee).toHaveBeenCalledWith(ACTOR, "c1", "Dana");
  });

  it("only looks among unfinished tasks unless asked otherwise", async () => {
    await tools.get("update_task")!.handler({ task: "Send the report", status: "DONE" }, CTX);
    expect(lookup.lookupTask).toHaveBeenCalledWith(ACTOR, "Send the report", {
      clientId: undefined,
      includeClosed: undefined,
    });

    await tools.get("update_task")!.handler(
      { task: "Send the report", status: "OPEN", includeDone: true },
      CTX,
    );
    expect(lookup.lookupTask).toHaveBeenLastCalledWith(ACTOR, "Send the report", {
      clientId: undefined,
      includeClosed: true,
    });
  });
});

describe("list_tasks", () => {
  it("is read-only, so a client may call it without asking first", () => {
    const ann = tools.get("list_tasks")!.config.annotations as { readOnlyHint?: boolean };
    expect(ann.readOnlyHint).toBe(true);
  });

  it("defaults to unfinished tasks", async () => {
    await tools.get("list_tasks")!.handler({}, CTX);
    const [, filters] = tasks.listTasks.mock.calls[0] as [unknown, { statusIn?: string[] }];
    expect(filters.statusIn).toEqual(["OPEN", "IN_PROGRESS"]);
  });

  it("scopes `mine` to the token's user, never to a name the model supplied", async () => {
    await tools.get("list_tasks")!.handler({ mine: true, person: "Dana" }, CTX);
    const [, filters] = tasks.listTasks.mock.calls[0] as [unknown, { assignedToId?: string }];
    expect(filters.assignedToId).toBe(ACTOR.id);
    expect(lookup.lookupAssignee).not.toHaveBeenCalled();
  });

  it("asks for a client before filtering by colleague, rather than guessing", async () => {
    const out = payload(await tools.get("list_tasks")!.handler({ person: "Dana" }, CTX));
    expect(tasks.listTasks).not.toHaveBeenCalled();
    expect(out.text).toMatch(/client/i);
  });
});
