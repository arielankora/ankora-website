import { beforeEach, describe, expect, it, vi } from "vitest";

// NUX handover pass (3.10.2026): the task tools a real project needs -
// steps, supervision and portal visibility at creation, what a task is
// waiting on, comments, a full read of one task, and the portal's
// decisions.
//
// Same approach as write-tools.test.ts: the domain layer is mocked, and
// what is under test is the tool surface's own decisions. Three of them
// matter more than the rest:
//
//   1. A call that is refused writes NOTHING (approval without a
//      supervisor, two recommendations, a waiting flag with no task).
//   2. A task never lands on the client's portal by omission:
//      clientVisible is false unless the model said true.
//   3. Money the model says in shekels is stored in agorot, rounded.

const tasks = vi.hoisted(() => ({
  listTasks: vi.fn(async () => [] as unknown[]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  assignableUsers: vi.fn(async () => [] as unknown[]),
  addTaskComment: vi.fn(),
  getTaskDetail: vi.fn(),
  removeTaskSteps: vi.fn(),
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"],
}));

const decisions = vi.hoisted(() => ({
  createDecision: vi.fn(),
  listDecisionsForClient: vi.fn(),
}));

const lookup = vi.hoisted(() => ({
  lookupClient: vi.fn(),
  lookupCategory: vi.fn(),
  lookupTeamMember: vi.fn(),
  lookupAssignee: vi.fn(),
  lookupTask: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

vi.mock("@/lib/app-domain/time-entries", () => ({}));
vi.mock("@/lib/app-domain/tasks", () => tasks);
vi.mock("@/lib/app-domain/decisions", () => decisions);
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/clients", () => ({ listAccessibleClients: vi.fn(async () => []) }));
vi.mock("@/lib/app-auth/permissions", () => ({ assertCan: vi.fn() }));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { shekelsToMinor } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS, WRITE_TOOLS } from "@/lib/mcp/annotations";

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

const ACTOR = { id: "u-ariel", name: "Ariel", role: "SUPER_ADMIN", timezone: "Asia/Jerusalem" };
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
const call = async (name: string, args: unknown) => payload(await tools.get(name)!.handler(args, CTX));

beforeEach(() => {
  vi.clearAllMocks();
  auth.actorFromAuthInfo.mockReturnValue(ACTOR);
  lookup.lookupClient.mockResolvedValue({ ok: true, value: { id: "c-nux", name: "NUX" } });
  lookup.lookupAssignee.mockImplementation(async (_a: unknown, _c: string, name: string) => ({
    ok: true,
    value: { id: `u-${name}`, name, email: `${name}@ankora.co.il` },
  }));
  lookup.lookupTask.mockResolvedValue({
    ok: true,
    value: { id: "t1", name: "התאמת עסקאות כרטיסי אשראי", clientId: "c-nux", clientName: "NUX" },
  });
  tasks.createTask.mockImplementation(async (_a: unknown, input: { title: string; parentId?: string }) => ({
    id: input.parentId ? `step-${input.title}` : "t-new",
    title: input.title,
    status: "OPEN",
    priority: "NORMAL",
    requiresApproval: false,
    clientVisible: false,
  }));
  tools = collectTools();
});

describe("registration", () => {
  it("registers every new tool with an annotation", () => {
    for (const name of ["get_task", "add_task_steps", "set_task_step", "add_task_comment", "create_decision", "list_decisions"]) {
      expect(tools.has(name), name).toBe(true);
      expect(TOOL_ANNOTATIONS).toHaveProperty(name);
    }
  });

  it("marks the reads read-only and the writes as writes", () => {
    expect(TOOL_ANNOTATIONS.get_task.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.list_decisions.readOnlyHint).toBe(true);
    for (const name of ["add_task_steps", "set_task_step", "add_task_comment", "create_decision"]) {
      expect(WRITE_TOOLS as readonly string[]).toContain(name);
    }
  });
});

describe("create_task with steps, supervision and visibility", () => {
  it("creates the task, then each step under it in order", async () => {
    const out = await call("create_task", {
      client: "NUX",
      title: "התאמת עסקאות כרטיסי אשראי",
      assignTo: "Hadas",
      supervisor: "Ariel",
      requireApproval: true,
      clientVisible: true,
      clientTitle: "התאמות אשראי ובנק",
      steps: ["היקף וטריגר", "נוהל", "הרשאות"],
    });

    expect(out.created).toBe(true);
    expect(out.steps).toEqual(["היקף וטריגר", "נוהל", "הרשאות"]);
    const [first, ...rest] = tasks.createTask.mock.calls;
    expect(first[1]).toMatchObject({
      clientId: "c-nux",
      assignedToId: "u-Hadas",
      supervisorId: "u-Ariel",
      requiresApproval: true,
      clientVisible: true,
      clientTitle: "התאמות אשראי ובנק",
    });
    expect(rest.map((c) => c[1])).toEqual([
      { clientId: "c-nux", title: "היקף וטריגר", parentId: "t-new" },
      { clientId: "c-nux", title: "נוהל", parentId: "t-new" },
      { clientId: "c-nux", title: "הרשאות", parentId: "t-new" },
    ]);
  });

  it("keeps a task off the portal unless asked, and drops a client title with it", async () => {
    await call("create_task", { client: "NUX", title: "x", clientTitle: "should not stick" });
    expect(tasks.createTask.mock.calls[0][1]).toMatchObject({ clientVisible: false, clientTitle: null });
  });

  it("writes nothing when approval is asked for with no supervisor", async () => {
    const out = await call("create_task", { client: "NUX", title: "x", requireApproval: true });
    expect(tasks.createTask).not.toHaveBeenCalled();
    expect(out.text).toContain("supervisor");
  });

  it("writes nothing when the supervisor does not resolve", async () => {
    lookup.lookupAssignee.mockResolvedValueOnce({ ok: false, message: "No team member named Guy." });
    await call("create_task", { client: "NUX", title: "x", supervisor: "Guy" });
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it("reports which steps exist when one fails, instead of failing the whole call", async () => {
    tasks.createTask
      .mockResolvedValueOnce({ id: "t-new", title: "x", status: "OPEN", priority: "NORMAL", requiresApproval: false, clientVisible: false })
      .mockResolvedValueOnce({ id: "s1" })
      .mockRejectedValueOnce(new Error("boom"));

    const out = await call("create_task", { client: "NUX", title: "x", steps: ["a", "b", "c"] });

    expect(out.created).toBe(true);
    expect(out.steps).toEqual(["a"]);
    expect(out.warning).toContain("Do not call create_task again");
    expect(tasks.createTask).toHaveBeenCalledTimes(3);
  });
});

describe("update_task: portal visibility and waiting", () => {
  beforeEach(() => {
    tasks.updateTask.mockResolvedValue({ id: "t1", title: "x", status: "IN_PROGRESS" });
  });

  it("marks a task as waiting on the client, with the reason", async () => {
    await call("update_task", { task: "x", waitingOn: "CLIENT", waitingReason: "אישור ספי הוצאה" });
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", {
      block: { on: "CLIENT", reason: "אישור ספי הוצאה" },
    });
  });

  it("clears the wait", async () => {
    await call("update_task", { task: "x", clearWaiting: true });
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", { block: null });
  });

  it("refuses waitingOn and clearWaiting together, and writes nothing", async () => {
    await call("update_task", { task: "x", waitingOn: "CLIENT", clearWaiting: true });
    expect(tasks.updateTask).not.toHaveBeenCalled();
  });

  it("refuses a reason with nobody to wait on", async () => {
    await call("update_task", { task: "x", waitingReason: "something" });
    expect(tasks.updateTask).not.toHaveBeenCalled();
  });

  it("passes portal visibility and the client title through", async () => {
    await call("update_task", { task: "x", clientVisible: true, clientTitle: "כותרת ללקוח" });
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", { clientVisible: true, clientTitle: "כותרת ללקוח" });
  });
});

const DETAIL = {
  task: {
    title: "התאמת עסקאות כרטיסי אשראי",
    client: { name: "NUX" },
    status: "IN_PROGRESS",
    priority: "HIGH",
    category: null,
    assignedTo: { name: "Hadas" },
    supervisor: { name: "Ariel" },
    requiresApproval: true,
    approvedBy: null,
    dueDate: new Date("2026-10-08T20:59:00Z"),
    description: "x",
    clientVisible: true,
    clientTitle: null,
    clientOutcome: null,
    blockedOn: null,
    blockedReason: null,
    blockedSince: null,
  },
  subtasks: [
    { id: "s1", title: "היקף וטריגר", status: "DONE", assignedTo: null },
    { id: "s2", title: "נוהל", status: "OPEN", assignedTo: null },
    { id: "s3", title: "ביצוע משותף", status: "OPEN", assignedTo: null },
  ],
  thread: [
    { kind: "comment", id: "c1", at: new Date("2026-10-05T08:00:00Z"), actorName: "Hadas", body: "גיא הראה את התהליך" },
    { kind: "event", id: "e1", at: new Date("2026-10-04T08:00:00Z"), actorName: "Ariel", label: "נוצרה", changed: [] },
  ],
  time: { totalSeconds: 5400, byUser: [], runningCount: 0, entryCount: 2 },
  commentCount: 1,
};

describe("get_task", () => {
  it("returns the steps, their progress and only the comments from the thread", async () => {
    tasks.getTaskDetail.mockResolvedValue(DETAIL);
    const out = await call("get_task", { task: "התאמת" });
    expect(out.stepsDone).toBe(1);
    expect(out.stepsTotal).toBe(3);
    expect(out.comments).toEqual([{ by: "Hadas", at: "2026-10-05T08:00:00.000Z", text: "גיא הראה את התהליך" }]);
    expect(out.dueDate).toBe("2026-10-08");
    expect(out.loggedMinutes).toBe(90);
  });

  it("says so when the task is not available, rather than inventing one", async () => {
    tasks.getTaskDetail.mockResolvedValue(null);
    const out = await call("get_task", { task: "x" });
    expect(out.text).toContain("not available");
  });
});

describe("set_task_step", () => {
  beforeEach(() => {
    tasks.getTaskDetail.mockResolvedValue(DETAIL);
    tasks.updateTask.mockResolvedValue({ id: "s2", status: "DONE" });
  });

  it("finds the step inside the named task and ticks it", async () => {
    const out = await call("set_task_step", { task: "התאמת", step: "נוהל", done: true });
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "s2", { status: "DONE" });
    expect(out.stepsDone).toBe(2);
  });

  it("reopens a step", async () => {
    tasks.updateTask.mockResolvedValue({ id: "s1", status: "OPEN" });
    await call("set_task_step", { task: "התאמת", step: "היקף", done: false });
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "s1", { status: "OPEN" });
  });

  it("writes nothing when the step does not resolve", async () => {
    const out = await call("set_task_step", { task: "התאמת", step: "אימות", done: true });
    expect(tasks.updateTask).not.toHaveBeenCalled();
    expect(out.text).toContain("step");
  });
});

describe("add_task_comment", () => {
  it("comments on the resolved task as the signed-in user", async () => {
    tasks.addTaskComment.mockResolvedValue({ createdAt: new Date("2026-10-05T08:00:00Z") });
    await call("add_task_comment", { task: "התאמת", text: "סוכם עם גיא" });
    expect(tasks.addTaskComment).toHaveBeenCalledWith(ACTOR, "t1", "סוכם עם גיא");
  });
});

describe("create_decision", () => {
  const OPTIONS = [
    { label: "3,000 דולר", amount: 10500.5, recommended: true },
    { label: "5,000 דולר", amount: 17500 },
  ];

  beforeEach(() => {
    decisions.createDecision.mockResolvedValue({
      question: "סף אישור לתוכנה",
      options: [{ label: "3,000 דולר" }, { label: "5,000 דולר" }],
    });
  });

  it("stores shekels as agorot, rounded", async () => {
    await call("create_decision", { client: "NUX", question: "סף אישור לתוכנה", options: OPTIONS, amount: 99.999 });
    const input = decisions.createDecision.mock.calls[0][1];
    expect(input.amountMinor).toBe(10000);
    expect(input.options.map((o: { amountMinor: number }) => o.amountMinor)).toEqual([1050050, 1750000]);
    expect(shekelsToMinor(0.1 + 0.2)).toBe(30);
  });

  it("refuses two recommendations and writes nothing", async () => {
    await call("create_decision", {
      client: "NUX",
      question: "q",
      options: [
        { label: "a", recommended: true },
        { label: "b", recommended: true },
      ],
    });
    expect(decisions.createDecision).not.toHaveBeenCalled();
  });

  it("refuses a waiting flag with no task", async () => {
    await call("create_decision", { client: "NUX", question: "q", options: OPTIONS, markTaskWaiting: true });
    expect(decisions.createDecision).not.toHaveBeenCalled();
  });

  it("links the task and marks it waiting on the client when asked", async () => {
    const out = await call("create_decision", {
      client: "NUX",
      question: "סף אישור לתוכנה",
      options: OPTIONS,
      task: "ספי אישור",
      markTaskWaiting: true,
    });
    expect(decisions.createDecision.mock.calls[0][1].taskId).toBe("t1");
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", { block: { on: "CLIENT", reason: "סף אישור לתוכנה" } });
    expect(out.taskMarkedWaitingOnClient).toBe(true);
    expect(out.note).toContain("not notified");
  });

  it("does not touch the task when the waiting flag is off", async () => {
    await call("create_decision", { client: "NUX", question: "q", options: OPTIONS, task: "ספי אישור" });
    expect(tasks.updateTask).not.toHaveBeenCalled();
  });
});

describe("list_decisions", () => {
  it("shows only open decisions unless asked for the rest", async () => {
    const base = {
      background: null,
      amountMinor: null,
      aboveCeiling: false,
      dueAt: null,
      createdAt: new Date("2026-10-04T08:00:00Z"),
      taskTitle: null,
      options: [],
    };
    decisions.listDecisionsForClient.mockResolvedValue([
      { ...base, question: "open one", status: "OPEN", answer: null },
      {
        ...base,
        question: "answered one",
        status: "ANSWERED",
        answer: { optionLabel: "a", amountMinor: 1000, respondedAt: new Date("2026-10-05T08:00:00Z"), respondedByName: "Oren" },
      },
    ]);

    const open = await call("list_decisions", { client: "NUX" });
    expect(open.decisions.map((d: { question: string }) => d.question)).toEqual(["open one"]);

    const all = await call("list_decisions", { client: "NUX", includeClosed: true });
    expect(all.decisions[1].answer).toEqual({ chose: "a", amount: 10, by: "Oren", on: "2026-10-05" });
  });
});

describe("a client portal user on the staff connector", () => {
  it("is pointed at the portal connector and reaches nothing", async () => {
    auth.actorFromAuthInfo.mockReturnValue({ id: "u-oren", name: "Oren", role: "CLIENT_USER", timezone: "Asia/Jerusalem" });
    for (const [name, args] of [
      ["list_tasks", {}],
      ["create_task", { client: "NUX", title: "x" }],
      ["get_task", { task: "x" }],
      ["create_decision", { client: "NUX", question: "q", options: [{ label: "a" }, { label: "b" }] }],
    ] as const) {
      const out = await call(name, args);
      expect(out.text, name).toContain("/api/mcp/portal");
    }
    expect(tasks.createTask).not.toHaveBeenCalled();
    expect(tasks.listTasks).not.toHaveBeenCalled();
    expect(decisions.createDecision).not.toHaveBeenCalled();
  });
});

describe("replace_task_steps", () => {
  beforeEach(() => {
    tasks.getTaskDetail.mockResolvedValue(DETAIL);
    tasks.removeTaskSteps.mockResolvedValue({
      removed: [
        { id: "s2", title: "נוהל" },
        { id: "s3", title: "ביצוע משותף" },
      ],
      kept: [{ id: "s1", title: "היקף וטריגר", why: "done" }],
      notSteps: [],
    });
  });

  it("asks to remove every step of the task, then adds the new list in order", async () => {
    const out = await call("replace_task_steps", { task: "התאמת", steps: ["שיחת הסבר", "מסמך עבודה"] });
    expect(tasks.removeTaskSteps).toHaveBeenCalledWith(ACTOR, "t1", ["s1", "s2", "s3"]);
    expect(tasks.createTask.mock.calls.map((c) => c[1])).toEqual([
      { clientId: "c-nux", title: "שיחת הסבר", parentId: "t1" },
      { clientId: "c-nux", title: "מסמך עבודה", parentId: "t1" },
    ]);
    expect(out.removed).toEqual(["נוהל", "ביצוע משותף"]);
    expect(out.kept).toEqual([{ title: "היקף וטריגר", why: "already done" }]);
    expect(out.added).toEqual(["שיחת הסבר", "מסמך עבודה"]);
  });

  it("does not add a second copy of a kept step that is in the new list", async () => {
    const out = await call("replace_task_steps", { task: "התאמת", steps: ["היקף וטריגר", "שיחת הסבר"] });
    expect(out.added).toEqual(["שיחת הסבר"]);
    expect(tasks.createTask).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the task is not found", async () => {
    lookup.lookupTask.mockResolvedValueOnce({ ok: false, message: "No task matches." });
    const out = await call("replace_task_steps", { task: "nothing", steps: ["x"] });
    expect(out.text).toContain("No task");
    expect(tasks.removeTaskSteps).not.toHaveBeenCalled();
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it("is the one write marked destructive", () => {
    expect(TOOL_ANNOTATIONS.replace_task_steps.destructiveHint).toBe(true);
    expect(WRITE_TOOLS as readonly string[]).toContain("replace_task_steps");
  });
});
