import { beforeEach, describe, expect, it, vi } from "vitest";

// 19.11.2026: update_time_entry and delete_time_entry.
//
// Before these two tools, an entry Claude made at the wrong hours could
// only be fixed on the screen, and the connector's only way forward was a
// second entry that billed the same work twice. What is under test is the
// tool surface's own decisions, with the domain mocked as in
// write-tools.test.ts:
//
//   1. Only the caller's own, finished, unmarked entry is touched. The
//      lookup is scoped to the verified actor, never to an argument.
//   2. Times are read through the same helper as the edit form, and only
//      as a full date + start + end.
//   3. An overlap with another client is saved only after the user agreed,
//      and a same-client overlap never.
//   4. A refusal of the domain reaches Claude in its own words, not as an
//      unexpected error.

const domain = vi.hoisted(() => ({
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  getActiveTimers: vi.fn(),
  updateActiveTimerNote: vi.fn(),
  createManualEntry: vi.fn(),
  listMyTimeEntries: vi.fn(),
  listTimeEntriesForAdmin: vi.fn(),
  combineWallClockTime: vi.fn(),
  closedBankForStoppedEntry: vi.fn(async (): Promise<unknown> => null),
  moveEntryIntoOpenBank: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
}));

const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  autoPickCategory: vi.fn(async (): Promise<unknown> => null),
  taskCategoryInfo: vi.fn(async (): Promise<unknown> => null),
  usableCategoryById: vi.fn(async (): Promise<unknown> => null),
  lookupTeamMember: vi.fn(),
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  lookupTaskById: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  excludedClients: new Set<string>(),
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { timeEntry: { findFirst: db.findFirst } } }));
vi.mock("@/lib/app-domain/ai-exclusion-db", () => ({
  aiExcludedTaskIds: vi.fn(async () => new Set()),
  aiExcludedClientIds: vi.fn(async () => db.excludedClients),
  isTaskAiExcluded: vi.fn(async () => false),
  isDocumentAiExcluded: vi.fn(async () => false),
}));
vi.mock("@/lib/app-domain/time-entries", () => domain);
vi.mock("@/lib/app-domain/tasks", () => ({
  listTasks: vi.fn(async () => []),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  assignableUsers: vi.fn(async () => []),
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS"],
}));
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/clients", () => ({ listAccessibleClients: vi.fn(async () => []) }));
vi.mock("@/lib/app-domain/decisions", () => ({ createDecision: vi.fn(), listDecisionsForClient: vi.fn() }));
vi.mock("@/lib/app-auth/permissions", () => ({ assertCan: vi.fn() }));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { ClosedBankError } from "@/lib/app-domain/closed-bank-guard";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

function collectTools() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>();
  registerAnkoraTools({
    registerTool: (name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { config, handler });
    },
  } as never);
  return tools;
}

const ACTOR = { id: "u-real", name: "Ariel", role: "ANKORA_EMPLOYEE" };
const CTX = { http: { authInfo: { token: "verified" } } };

function payload(result: { content: { type: string; text: string }[] }) {
  const text = result.content.map((c) => c.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/// The 19.11 entry from the conversation that asked for these tools.
const ENTRY = {
  id: "e1",
  userId: "u-real",
  clientId: "c-grantor",
  categoryId: "cat1",
  taskId: null,
  startAt: new Date("2026-11-19T03:46:00Z"),
  endAt: new Date("2026-11-19T06:00:00Z"),
  actualSeconds: 134 * 60,
  billableSeconds: 134 * 60,
  note: "Grantor review",
  deletedAt: null,
  client: { id: "c-grantor", name: "Grantor" },
  category: { id: "cat1", name: "Development" },
  task: null,
};

function overlapError(sameClient: boolean) {
  return Object.assign(new Error("This time range overlaps an existing entry."), {
    name: "OverlapError",
    sameClient,
    conflicting: {
      startAt: new Date("2026-11-19T05:24:00Z"),
      endAt: new Date("2026-11-19T05:55:00Z"),
      client: { name: sameClient ? "Grantor" : "NUX" },
    },
  });
}

let tools: ReturnType<typeof collectTools>;

beforeEach(() => {
  vi.clearAllMocks();
  db.excludedClients = new Set();
  auth.actorFromAuthInfo.mockReturnValue(ACTOR);
  domain.combineWallClockTime.mockImplementation((date: string, time: string) => new Date(`${date}T${time}:00+02:00`));
  db.findFirst.mockResolvedValue(ENTRY);
  domain.updateTimeEntry.mockImplementation(async (_actor: unknown, id: string, input: { startAt?: Date; endAt?: Date; note?: string }) => ({
    ...ENTRY,
    id,
    startAt: input.startAt ?? ENTRY.startAt,
    endAt: input.endAt ?? ENTRY.endAt,
    actualSeconds: 140 * 60,
    billableSeconds: 140 * 60,
    note: input.note ?? ENTRY.note,
  }));
  domain.deleteTimeEntry.mockResolvedValue({ ...ENTRY, deletedAt: new Date() });
  tools = collectTools();
});

describe("registration", () => {
  it("registers both tools with the annotations the map declares", () => {
    expect(tools.get("update_time_entry")!.config.annotations).toBe(TOOL_ANNOTATIONS.update_time_entry);
    expect(tools.get("delete_time_entry")!.config.annotations).toBe(TOOL_ANNOTATIONS.delete_time_entry);
    expect(TOOL_ANNOTATIONS.delete_time_entry.destructiveHint).toBe(true);
    expect(TOOL_ANNOTATIONS.update_time_entry.readOnlyHint).toBe(false);
  });
});

describe("update_time_entry", () => {
  const MOVE = { entryId: "e1", date: "2026-11-19", start: "08:00", end: "10:20" };

  it("looks the entry up only among the caller's own, live entries", async () => {
    await tools.get("update_time_entry")!.handler({ ...MOVE, user: "someone-else" }, CTX);
    expect(db.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1", userId: "u-real", deletedAt: null } })
    );
  });

  it("moves the times through the edit form's helper and reports the new range", async () => {
    const out = payload(await tools.get("update_time_entry")!.handler({ ...MOVE, reason: "wrong hours" }, CTX));

    expect(domain.combineWallClockTime).toHaveBeenCalledWith("2026-11-19", "08:00");
    expect(domain.combineWallClockTime).toHaveBeenCalledWith("2026-11-19", "10:20");
    const [actor, id, input] = domain.updateTimeEntry.mock.calls[0];
    expect(actor).toBe(ACTOR);
    expect(id).toBe("e1");
    expect(input).toMatchObject({
      startAt: new Date("2026-11-19T06:00:00Z"),
      endAt: new Date("2026-11-19T08:20:00Z"),
      reason: "wrong hours",
      allowOverlapOverride: false,
    });
    expect(out).toMatchObject({ updated: true, entryId: "e1", client: "Grantor", startAt: "2026-11-19T06:00:00.000Z", actualMinutes: 140 });
  });

  it("refuses a partial set of times, and changes nothing", async () => {
    const out = payload(await tools.get("update_time_entry")!.handler({ entryId: "e1", start: "08:00" }, CTX));
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("date, start and end together");
  });

  it("refuses an end that is not after the start", async () => {
    await tools.get("update_time_entry")!.handler({ ...MOVE, start: "10:20", end: "08:00" }, CTX);
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
  });

  it("refuses a call with nothing to change", async () => {
    const out = payload(await tools.get("update_time_entry")!.handler({ entryId: "e1" }, CTX));
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("Nothing was changed");
  });

  it("changes only the note when only the note is given", async () => {
    await tools.get("update_time_entry")!.handler({ entryId: "e1", note: "Grantor call" }, CTX);
    const input = domain.updateTimeEntry.mock.calls[0][2];
    expect(input).toMatchObject({ note: "Grantor call", startAt: undefined, endAt: undefined, categoryId: undefined, taskId: undefined });
  });

  it("resolves a new category against the entry's own client", async () => {
    lookup.lookupCategory.mockResolvedValue({ ok: true, value: { id: "cat2", name: "Meetings" } });
    const out = payload(await tools.get("update_time_entry")!.handler({ entryId: "e1", category: "meetings" }, CTX));
    expect(lookup.lookupCategory).toHaveBeenCalledWith(ACTOR, "c-grantor", "meetings");
    expect(domain.updateTimeEntry.mock.calls[0][2]).toMatchObject({ categoryId: "cat2" });
    expect(out.category).toBe("Meetings");
  });

  it("writes nothing when a task does not resolve on the entry's client", async () => {
    lookup.lookupTask.mockResolvedValue({ ok: false, message: "No task matches." });
    const out = payload(await tools.get("update_time_entry")!.handler({ entryId: "e1", task: "nope" }, CTX));
    expect(lookup.lookupTask).toHaveBeenCalledWith(ACTOR, "nope", { clientId: "c-grantor" });
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toBe("No task matches.");
  });

  it("says so when the entry is not the caller's", async () => {
    db.findFirst.mockResolvedValue(null);
    const out = payload(await tools.get("update_time_entry")!.handler(MOVE, CTX));
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("No entry of yours");
  });

  it("sends a running timer to the timer tools", async () => {
    db.findFirst.mockResolvedValue({ ...ENTRY, endAt: null });
    const out = payload(await tools.get("update_time_entry")!.handler({ entryId: "e1", note: "x" }, CTX));
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("update_timer_note");
  });

  it("refuses an entry on a client marked בלי AI", async () => {
    db.excludedClients = new Set(["c-grantor"]);
    await tools.get("update_time_entry")!.handler({ entryId: "e1", note: "x" }, CTX);
    expect(domain.updateTimeEntry).not.toHaveBeenCalled();
  });

  it("asks before keeping an overlap with another client, and keeps it only once agreed", async () => {
    domain.updateTimeEntry.mockRejectedValueOnce(overlapError(false));
    const first = payload(await tools.get("update_time_entry")!.handler(MOVE, CTX));
    expect(domain.updateTimeEntry).toHaveBeenCalledTimes(1);
    expect(first.text).toContain("NUX");
    expect(first.text).toContain("update_time_entry again");
    expect(first.text).toContain("Nothing was changed");

    domain.updateTimeEntry.mockReset();
    domain.updateTimeEntry
      .mockRejectedValueOnce(overlapError(false))
      .mockResolvedValueOnce({ ...ENTRY, startAt: new Date("2026-11-19T06:00:00Z"), endAt: new Date("2026-11-19T08:20:00Z") });
    const second = payload(await tools.get("update_time_entry")!.handler({ ...MOVE, confirmParallel: true }, CTX));
    expect(domain.updateTimeEntry.mock.calls[0][2]).toMatchObject({ allowOverlapOverride: false });
    expect(domain.updateTimeEntry.mock.calls[1][2]).toMatchObject({ allowOverlapOverride: true });
    expect(second).toMatchObject({ updated: true, parallel: true, parallelWith: { client: "NUX" } });
  });

  it("never pushes a same-client overlap through, even with confirmParallel", async () => {
    domain.updateTimeEntry.mockRejectedValueOnce(overlapError(true));
    const out = payload(await tools.get("update_time_entry")!.handler({ ...MOVE, confirmParallel: true }, CTX));
    expect(domain.updateTimeEntry).toHaveBeenCalledTimes(1);
    expect(out.text).toContain("one client cannot have two entries");
  });

  it("passes the 48-hour edit window refusal on as a known message", async () => {
    domain.updateTimeEntry.mockRejectedValueOnce(Object.assign(new Error("expired"), { name: "EditWindowExpiredError" }));
    const result = await tools.get("update_time_entry")!.handler(MOVE, CTX);
    expect(result.content[0].text).toContain("48-hour self-edit window");
    expect(result.content[0].text).not.toContain("unexpected");
  });

  it("passes a domain refusal on in its own words", async () => {
    domain.updateTimeEntry.mockRejectedValueOnce(
      Object.assign(new Error("A note is required."), { name: "DomainError", code: "timeEntries.noteRequired" })
    );
    const result = await tools.get("update_time_entry")!.handler(MOVE, CTX);
    expect(result.content[0].text).toContain("A note is required.");
    expect(result.content[0].text).not.toContain("unexpected");
  });

  it("explains a closed hour bank, with nothing changed", async () => {
    const hit = {
      closed: { id: "b1", kind: "PACKAGE", cycleStart: new Date("2026-10-01T00:00:00Z"), cycleEnd: new Date("2026-11-01T00:00:00Z") },
      open: null,
    };
    const err = new ClosedBankError(hit as never, "change", false);
    domain.updateTimeEntry.mockRejectedValueOnce(err);
    const result = await tools.get("update_time_entry")!.handler(MOVE, CTX);
    expect(result.content[0].text).toContain("Nothing was changed");
    expect(result.content[0].text).toContain(err.message);
    expect(result.content[0].text).not.toContain("unexpected");
  });
});

describe("delete_time_entry", () => {
  it("deletes the caller's own finished entry and says what it was", async () => {
    const out = payload(await tools.get("delete_time_entry")!.handler({ entryId: "e1" }, CTX));
    expect(db.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "e1", userId: "u-real", deletedAt: null } })
    );
    expect(domain.deleteTimeEntry).toHaveBeenCalledWith(ACTOR, "e1", { closedBankOverride: null });
    expect(out).toMatchObject({ deleted: true, entryId: "e1", client: "Grantor", actualMinutes: 134, note: "Grantor review" });
  });

  it("passes a manager's closed-bank reason through", async () => {
    await tools.get("delete_time_entry")!.handler({ entryId: "e1", closedBankOverrideReason: " client agreed " }, CTX);
    expect(domain.deleteTimeEntry).toHaveBeenCalledWith(ACTOR, "e1", { closedBankOverride: { reason: "client agreed" } });
  });

  it("deletes nothing that is not the caller's", async () => {
    db.findFirst.mockResolvedValue(null);
    const out = payload(await tools.get("delete_time_entry")!.handler({ entryId: "e1" }, CTX));
    expect(domain.deleteTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("Nothing was deleted");
  });

  it("does not discard a running timer", async () => {
    db.findFirst.mockResolvedValue({ ...ENTRY, endAt: null });
    const out = payload(await tools.get("delete_time_entry")!.handler({ entryId: "e1" }, CTX));
    expect(domain.deleteTimeEntry).not.toHaveBeenCalled();
    expect(out.text).toContain("stop_timer");
  });

  it("refuses an entry on a client marked בלי AI", async () => {
    db.excludedClients = new Set(["c-grantor"]);
    await tools.get("delete_time_entry")!.handler({ entryId: "e1" }, CTX);
    expect(domain.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it("passes a permission refusal on as a known message", async () => {
    domain.deleteTimeEntry.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "ForbiddenError" }));
    const result = await tools.get("delete_time_entry")!.handler({ entryId: "e1" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Permission denied");
  });
});
