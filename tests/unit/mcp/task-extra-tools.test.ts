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
  lookupTaskById: vi.fn(),
  usableCategories: vi.fn(),
  teamMembers: vi.fn(),
  canSeeOthersTime: vi.fn(() => false),
}));

const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

// "קדם עם קלוד" (10.10.2026). The real error classes, so the tools'
// instanceof checks are exercised as they run in production.
const plans = vi.hoisted(() => {
  class PlanVersionConflictError extends Error {
    constructor(public readonly latestVersion: number) {
      super("conflict");
      this.name = "PlanVersionConflictError";
    }
  }
  return {
    PlanVersionConflictError,
    getTaskPlans: vi.fn(async () => ({ current: null, versions: [] }) as unknown),
    saveTaskPlan: vi.fn(),
    applyPlanSteps: vi.fn(),
  };
});

vi.mock("@/lib/app-domain/time-entries", () => ({}));
vi.mock("@/lib/app-domain/tasks", () => tasks);
vi.mock("@/lib/app-domain/decisions", () => decisions);
vi.mock("@/lib/mcp/lookup", () => lookup);
vi.mock("@/lib/mcp/auth", () => auth);
vi.mock("@/lib/app-domain/task-plans", () => plans);
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
    expect(out.url).toBe("https://www.ankora.co.il/app/tasks/t-new");
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

  it("returns the task's link alongside the change", async () => {
    const out = await call("update_task", { task: "x", priority: "HIGH" });
    expect(out.url).toBe("https://www.ankora.co.il/app/tasks/t1");
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
    id: "t-detail",
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

  it("returns the task's id and its link in the app, so a summary can point at it", async () => {
    // The request that produced this: an email to a colleague listing the
    // tasks opened in a meeting, each with its link. Before this the model
    // had no id and no address, and had to say it could not link.
    tasks.getTaskDetail.mockResolvedValue(DETAIL);
    const out = await call("get_task", { task: "התאמת" });
    expect(out.id).toBe(DETAIL.task.id);
    expect(out.url).toBe(`https://www.ankora.co.il/app/tasks/${DETAIL.task.id}`);
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

// "קדם עם קלוד" (10.10.2026): the work plan of a task, through Claude.
//
// What matters here: a plan is found by exact id when the prompt gave one,
// it is saved as approved only when the model says the user approved it,
// a save written against an old version saves nothing and says what to do,
// and a refusal from the plan rules reaches the user in its own words
// rather than as "unexpected server error".
const PLAN_ROW = {
  id: "p2",
  version: 2,
  body: "**מטרה**\nלסגור את ההתאמה.",
  steps: ["לבקש דוח", "להתאים"],
  status: "APPROVED",
  origin: "MCP",
  changeNote: null,
  createdAt: new Date("2026-10-10T08:00:00Z"),
  approvedAt: new Date("2026-10-10T08:00:00Z"),
  stepsAppliedAt: null,
  createdBy: { id: "u-ariel", name: "Ariel" },
  approvedBy: { id: "u-ariel", name: "Ariel" },
};

describe("finding a task by id", () => {
  it("uses the exact id when given, and never the title search", async () => {
    lookup.lookupTaskById.mockResolvedValue({
      ok: true,
      value: { id: "t-exact", name: "התאמה", clientId: "c-nux", clientName: "NUX" },
    });
    plans.getTaskPlans.mockResolvedValue({ current: null, versions: [] });
    const out = await call("get_task_plan", { taskId: "t-exact" });
    expect(lookup.lookupTaskById).toHaveBeenCalledWith(ACTOR, "t-exact");
    expect(lookup.lookupTask).not.toHaveBeenCalled();
    expect(out.taskId).toBe("t-exact");
    expect(out.plan).toBeNull();
    expect(out.baseVersion).toBe(0);
  });

  it("asks which task when neither a title nor an id was given", async () => {
    const out = await call("get_task_plan", {});
    expect(out.text).toMatch(/taskId/);
    expect(plans.getTaskPlans).not.toHaveBeenCalled();
  });

  it("passes a foreign or mistyped id's refusal through, and reads nothing", async () => {
    lookup.lookupTaskById.mockResolvedValue({ ok: false, message: 'No task with id "nope" is available to this user.' });
    const out = await call("save_task_plan", { taskId: "nope", plan: "x", approved: true, baseVersion: 0 });
    expect(out.text).toMatch(/No task with id/);
    expect(plans.saveTaskPlan).not.toHaveBeenCalled();
  });

  it("update_task accepts the id too", async () => {
    lookup.lookupTaskById.mockResolvedValue({
      ok: true,
      value: { id: "t1", name: "x", clientId: "c-nux", clientName: "NUX" },
    });
    tasks.updateTask.mockResolvedValue({ id: "t1", title: "x", status: "IN_PROGRESS" });
    await call("update_task", { taskId: "t1", priority: "HIGH" });
    expect(lookup.lookupTask).not.toHaveBeenCalled();
    expect(tasks.updateTask).toHaveBeenCalledWith(ACTOR, "t1", expect.objectContaining({ priority: "HIGH" }));
  });
});

describe("get_task_plan and get_task", () => {
  it("returns the current plan and the version to save against", async () => {
    plans.getTaskPlans.mockResolvedValue({ current: PLAN_ROW, versions: [PLAN_ROW, { ...PLAN_ROW, version: 1 }] });
    const out = await call("get_task_plan", { task: "התאמת" });
    expect(out.plan.version).toBe(2);
    expect(out.plan.plan).toBe(PLAN_ROW.body);
    expect(out.plan.steps).toEqual(PLAN_ROW.steps);
    expect(out.plan.writtenVia).toBe("Claude");
    expect(out.baseVersion).toBe(2);
    expect(out.versions).toBe(2);
    expect(out).not.toHaveProperty("history");
  });

  it("includes the earlier versions only when asked", async () => {
    plans.getTaskPlans.mockResolvedValue({ current: PLAN_ROW, versions: [PLAN_ROW, { ...PLAN_ROW, version: 1 }] });
    const out = await call("get_task_plan", { task: "התאמת", includeHistory: true });
    expect(out.history.map((h: { version: number }) => h.version)).toEqual([1]);
  });

  it("get_task carries the current plan", async () => {
    tasks.getTaskDetail.mockResolvedValue(DETAIL);
    plans.getTaskPlans.mockResolvedValue({ current: PLAN_ROW, versions: [PLAN_ROW] });
    const out = await call("get_task", { task: "התאמת" });
    expect(out.plan.version).toBe(2);
  });
});

describe("save_task_plan", () => {
  it("saves an approved plan from Claude, with its steps and the version it was written against", async () => {
    plans.saveTaskPlan.mockResolvedValue({ ...PLAN_ROW, version: 3 });
    const out = await call("save_task_plan", {
      task: "התאמת",
      plan: "**מטרה**\nלסגור.",
      steps: ["לבקש דוח", "להתאים"],
      approved: true,
      baseVersion: 2,
      changeNote: "נוסף שלב",
    });
    expect(plans.saveTaskPlan).toHaveBeenCalledWith(ACTOR, "t1", {
      body: "**מטרה**\nלסגור.",
      steps: ["לבקש דוח", "להתאים"],
      approved: true,
      baseVersion: 2,
      changeNote: "נוסף שלב",
      origin: "MCP",
    });
    expect(out.saved).toBe(true);
    expect(out.version).toBe(3);
    expect(out.next).toMatch(/apply_task_plan_steps/);
  });

  it("passes approved: false through as a draft, and does not offer to copy steps", async () => {
    plans.saveTaskPlan.mockResolvedValue({ ...PLAN_ROW, status: "DRAFT", version: 1 });
    const out = await call("save_task_plan", { task: "התאמת", plan: "x", approved: false, baseVersion: 0 });
    expect(plans.saveTaskPlan.mock.calls[0][2].approved).toBe(false);
    expect(out.next).toBeNull();
  });

  it("on a newer version, saves nothing and tells the model to read and ask", async () => {
    plans.saveTaskPlan.mockRejectedValue(new plans.PlanVersionConflictError(4));
    const out = await call("save_task_plan", { task: "התאמת", plan: "x", approved: true, baseVersion: 2 });
    expect(out.saved).toBe(false);
    expect(out.conflict).toBe(true);
    expect(out.latestVersion).toBe(4);
    expect(out.message).toMatch(/get_task_plan/);
  });

  it("relays a plan rule refusal in its own words", async () => {
    const { TaskPlanRuleError, PLAN_TOO_LONG_MESSAGE } = await import("@/lib/task-plan-rules");
    plans.saveTaskPlan.mockRejectedValue(new TaskPlanRuleError(PLAN_TOO_LONG_MESSAGE));
    const result = await tools.get("save_task_plan")!.handler(
      { task: "התאמת", plan: "x", approved: true, baseVersion: 0 },
      CTX
    );
    expect(result.content[0].text).toBe(PLAN_TOO_LONG_MESSAGE);
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it("says in its description to save only after explicit approval", () => {
    const description = String(tools.get("save_task_plan")!.config.description);
    expect(description).toMatch(/ONLY after the user has explicitly approved/);
  });
});

describe("apply_task_plan_steps", () => {
  it("reports what was added, removed and kept", async () => {
    plans.applyPlanSteps.mockResolvedValue({
      version: 2,
      added: ["להתאים"],
      removed: [{ id: "s1", title: "ישן" }],
      kept: [{ id: "s2", title: "לבקש דוח", why: "done" }],
    });
    const out = await call("apply_task_plan_steps", { task: "התאמת" });
    expect(out.added).toEqual(["להתאים"]);
    expect(out.removed).toEqual(["ישן"]);
    expect(out.kept).toEqual([{ title: "לבקש דוח", why: "already done" }]);
  });

  it("is registered as a destructive write", () => {
    expect(TOOL_ANNOTATIONS.apply_task_plan_steps.destructiveHint).toBe(true);
    expect(WRITE_TOOLS as readonly string[]).toContain("apply_task_plan_steps");
    expect(WRITE_TOOLS as readonly string[]).toContain("save_task_plan");
    expect(TOOL_ANNOTATIONS.get_task_plan.readOnlyHint).toBe(true);
  });
});

describe("create_decision linked by task id", () => {
  const OPTIONS = [{ label: "כן" }, { label: "לא" }];

  beforeEach(() => {
    decisions.createDecision.mockResolvedValue({ question: "q", options: [{ label: "כן" }, { label: "לא" }] });
  });

  it("links the decision to the exact task, without a title search", async () => {
    lookup.lookupTaskById.mockResolvedValue({
      ok: true,
      value: { id: "t-exact", name: "התאמה", clientId: "c-nux", clientName: "NUX" },
    });
    await call("create_decision", { client: "NUX", question: "q", options: OPTIONS, taskId: "t-exact" });
    expect(lookup.lookupTask).not.toHaveBeenCalled();
    expect(decisions.createDecision.mock.calls[0][1].taskId).toBe("t-exact");
  });

  it("refuses a task that belongs to another client, and creates nothing", async () => {
    lookup.lookupTaskById.mockResolvedValue({
      ok: true,
      value: { id: "t-other", name: "משהו", clientId: "c-rimed", clientName: "RIMED" },
    });
    const out = await call("create_decision", { client: "NUX", question: "q", options: OPTIONS, taskId: "t-other" });
    expect(out.text).toMatch(/RIMED/);
    expect(decisions.createDecision).not.toHaveBeenCalled();
  });

  it("accepts markTaskWaiting with a task id alone", async () => {
    lookup.lookupTaskById.mockResolvedValue({
      ok: true,
      value: { id: "t-exact", name: "התאמה", clientId: "c-nux", clientName: "NUX" },
    });
    const out = await call("create_decision", {
      client: "NUX",
      question: "q",
      options: OPTIONS,
      taskId: "t-exact",
      markTaskWaiting: true,
    });
    expect(out.text ?? "").not.toMatch(/markTaskWaiting needs/);
    expect(decisions.createDecision).toHaveBeenCalled();
  });
});
