import { beforeEach, describe, expect, it, vi } from "vitest";

// Employee lifecycle: the onboarding and offboarding tasks the server
// opens, and the access it revokes on suspension. The database, the tasks
// module and the MCP revoke path are mocked: what is under test is what
// this module decides and in what order, not the modules it calls.

const db = {
  client: { findFirst: vi.fn() },
  category: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  userClientAccess: { findMany: vi.fn() },
  task: { findMany: vi.fn(), findFirst: vi.fn() },
  taskComment: { create: vi.fn() },
  passkey: { deleteMany: vi.fn(), count: vi.fn() },
  employeeAgreement: { findFirst: vi.fn() },
  stepUpGrant: { deleteMany: vi.fn() },
  agreementSignLink: { updateMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const recordAudit = vi.fn();
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));

const createTask = vi.fn();
const updateTask = vi.fn();
const completeStepAsSystem = vi.fn();
const assignableUsers = vi.fn();
vi.mock("@/lib/app-domain/tasks", () => ({
  OPEN_STATUSES: ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"],
  createTask: (...a: unknown[]) => createTask(...a),
  updateTask: (...a: unknown[]) => updateTask(...a),
  completeStepAsSystem: (...a: unknown[]) => completeStepAsSystem(...a),
  assignableUsers: (...a: unknown[]) => assignableUsers(...a),
}));

const revokeClaude = vi.fn();
vi.mock("@/lib/app-domain/mcp-connections", () => ({
  revokeClaudeGrantsForUser: (...a: unknown[]) => revokeClaude(...a),
}));
const autoPickCategory = vi.fn();
vi.mock("@/lib/mcp/lookup", () => ({ autoPickCategory: (...a: unknown[]) => autoPickCategory(...a) }));

const lifecycle = await import("@/lib/app-domain/employee-lifecycle");
const prompts = await import("@/lib/employee-lifecycle-prompts");

const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];
const hasDash = (s: string) => DASHES.some((d) => s.includes(d));

function person(o: Record<string, unknown> = {}) {
  return {
    id: "emp",
    name: "נועה לוי",
    email: "noa@ankora.co.il",
    role: "ANKORA_EMPLOYEE",
    status: "INVITED",
    personalEmail: null,
    ...o,
  } as never;
}
const admin = { id: "admin", name: "אריאל", role: "SUPER_ADMIN" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.client.findFirst.mockResolvedValue({ id: "internal", name: "Ankora פנימי" });
  db.user.findFirst.mockResolvedValue({ id: "hadas", name: "הדס", role: "ANKORA_ADMIN" });
  assignableUsers.mockResolvedValue([{ id: "hadas" }, { id: "admin" }]);
  db.userClientAccess.findMany.mockResolvedValue([{ client: { name: "לקוח א" } }]);
  db.task.findMany.mockResolvedValue([]);
  db.taskComment.create.mockResolvedValue({ id: "c1" });
  let n = 0;
  createTask.mockImplementation(async (_a: unknown, input: { clientId: string }) => ({ id: `t${n++}`, clientId: input.clientId }));
  db.passkey.deleteMany.mockResolvedValue({ count: 2 });
  db.stepUpGrant.deleteMany.mockResolvedValue({ count: 1 });
  db.agreementSignLink.updateMany.mockResolvedValue({ count: 0 });
  revokeClaude.mockResolvedValue({ ok: true, revoked: 3 });
  db.category.findFirst.mockResolvedValue(null);
  autoPickCategory.mockResolvedValue({ id: "cat-1", name: "תפעול" });
});

describe("prompts", () => {
  it("names the task id, the people and nothing with a dash", () => {
    const on = prompts.onboardingPrompt({ ownerName: "הדס", employeeName: "נועה לוי", employeeEmail: "noa@ankora.co.il", taskId: "task-123" });
    expect(on).toContain('taskId "task-123"');
    expect(on).toContain("אני הדס מאנקורה");
    expect(on).toContain("נועה לוי (noa@ankora.co.il)");
    expect(hasDash(on)).toBe(false);

    const off = prompts.offboardingPrompt({ ownerName: "אריאל", employeeName: "נועה לוי", taskId: "task-9", deadline: "20.10.2026" });
    expect(off).toContain('taskId "task-9"');
    expect(off).toContain("המועד לביטול כל הגישות: 20.10.2026.");
    expect(hasDash(off)).toBe(false);
  });

  it("puts the prompt in a fenced block under its lead line, with the procedure link", () => {
    const d = prompts.onboardingDescription({
      employeeName: "נועה",
      role: "ANKORA_EMPLOYEE",
      workEmail: "noa@ankora.co.il",
      hasPersonalEmail: false,
      prompt: "PROMPT",
    });
    expect(d).toContain(prompts.PROCEDURE_DOC_URL);
    expect(d).toContain("פרומט לקלוד");
    expect(d).toContain("מומלץ להעתיק את הפרומט לקלוד (בחשבון הארגוני), והוא ינהל את הקליטה עד הסוף.\n\n```\nPROMPT\n```");
    expect(d).toContain("חסר");
    expect(hasDash(d)).toBe(false);
  });

  it("keeps the step lists exact and dash free", () => {
    expect(prompts.ONBOARDING_STEPS).toHaveLength(9);
    expect(prompts.OFFBOARDING_STEPS).toHaveLength(9);
    expect(prompts.ONBOARDING_STEPS[prompts.ONBOARDING_SIGN_STEP]).toBe("אישור ההתחייבות באפליקציה והגדרת passkey");
    expect([...prompts.ONBOARDING_STEPS, ...prompts.OFFBOARDING_STEPS].some(hasDash)).toBe(false);
  });
});

describe("business-day due dates (Israel)", () => {
  it("counts Sunday to Thursday only", () => {
    // Thursday 15.10.2026, morning in Israel.
    const now = new Date("2026-10-15T07:00:00Z");
    expect(lifecycle.businessDueDate(3, now).key).toBe("2026-10-20");
    expect(lifecycle.businessDueDate(5, now).key).toBe("2026-10-22");
    expect(lifecycle.businessDueDate(3, now).date.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("starts from the Israeli day, not the UTC one", () => {
    // 22:30 UTC on Thursday is already Friday in Israel.
    expect(lifecycle.businessDueDate(1, new Date("2026-10-15T22:30:00Z")).key).toBe("2026-10-18");
  });

  it("skips a holiday", () => {
    // Yom Kippur 5787 is Monday 21.9.2026.
    expect(lifecycle.businessDueDate(2, new Date("2026-09-17T07:00:00Z")).key).toBe("2026-09-22");
  });

  it("formats the deadline for reading", () => {
    expect(lifecycle.displayDate("2026-10-20")).toBe("20.10.2026");
  });
});

describe("shouldOpenOffboarding", () => {
  it("opens only when no offboarding task is still open", () => {
    expect(lifecycle.shouldOpenOffboarding([])).toBe(true);
    expect(lifecycle.shouldOpenOffboarding([{ status: "DONE" }, { status: "ARCHIVED" }])).toBe(true);
    expect(lifecycle.shouldOpenOffboarding([{ status: "DONE" }, { status: "OPEN" }])).toBe(false);
    expect(lifecycle.shouldOpenOffboarding([{ status: "PENDING_APPROVAL" }])).toBe(false);
  });
});

describe("openOnboardingTask", () => {
  it("opens the task on the owner, about the employee, with its steps in order and step 1 done", async () => {
    const id = await lifecycle.openOnboardingTask(admin, person());
    expect(id).toBe("t0");

    const parent = createTask.mock.calls[0][1];
    expect(parent).toMatchObject({
      clientId: "internal",
      title: "קליטת עובד: נועה לוי",
      priority: "NORMAL",
      assignedToId: "hadas",
      clientVisible: false,
      categoryId: "cat-1",
      subject: { userId: "emp", kind: "ONBOARDING" },
    });
    const stepTitles = createTask.mock.calls.slice(1).map((c) => c[1].title);
    expect(stepTitles).toEqual([...prompts.ONBOARDING_STEPS]);
    expect(createTask.mock.calls.slice(1).every((c) => c[1].parentId === "t0")).toBe(true);

    // The description carries the prompt with the task's own id.
    const description = updateTask.mock.calls.find((c) => c[2].description)![2].description;
    expect(description).toContain('taskId "t0"');
    expect(description).toContain("אני הדס מאנקורה");
    expect(updateTask).toHaveBeenCalledWith(admin, "t1", { status: "DONE" });
  });

  it("falls back to the person inviting when the owner cannot take the task", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await lifecycle.openOnboardingTask(admin, person());
    expect(createTask.mock.calls[0][1].assignedToId).toBe("admin");
  });

  it("never throws and audits the failure when there is no internal client", async () => {
    db.client.findFirst.mockResolvedValue(null);
    await expect(lifecycle.openOnboardingTask(admin, person())).resolves.toBeNull();
    expect(createTask).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "employee_lifecycle.trigger_failed", entityId: "emp" }));
  });

  it("opens nothing for a client portal user", async () => {
    await expect(lifecycle.openOnboardingTask(admin, person({ role: "CLIENT_USER" }))).resolves.toBeNull();
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("revokeAccessOnSuspension", () => {
  it("removes passkeys and step-up windows, keeps deletion links, revokes Claude, and audits each class", async () => {
    const counts = await lifecycle.revokeAccessOnSuspension(admin, "emp");
    expect(counts).toEqual({ passkeys: 2, stepUpGrants: 1, signLinks: 0, claudeGrants: 3 });
    expect(db.passkey.deleteMany).toHaveBeenCalledWith({ where: { userId: "emp" } });
    expect(db.stepUpGrant.deleteMany).toHaveBeenCalledWith({ where: { userId: "emp" } });
    expect(db.agreementSignLink.updateMany.mock.calls[0][0].where).toMatchObject({
      userId: "emp",
      usedAt: null,
      kind: { not: "DELETION_DECLARATION" },
    });
    expect(revokeClaude).toHaveBeenCalledWith(admin, "emp");
    const actions = recordAudit.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["employee.passkeys_removed", "employee.step_up_revoked", "employee.sign_links_expired"]);
    expect(recordAudit.mock.calls[2][0].after).toEqual({ count: 0 });
  });
});

describe("runOffboarding", () => {
  it("revokes, then opens a HIGH task with a 3-business-day deadline and a comment of what was revoked", async () => {
    const id = await lifecycle.runOffboarding(admin, person({ status: "SUSPENDED", personalEmail: "noa@example.com" }));
    expect(id).toBe("t0");
    expect(db.passkey.deleteMany).toHaveBeenCalled();

    const parent = createTask.mock.calls[0][1];
    expect(parent).toMatchObject({ title: "עזיבת עובד: נועה לוי", priority: "HIGH", subject: { userId: "emp", kind: "OFFBOARDING" } });
    // Owner lookup asks for the offboarding owner's address.
    expect(db.user.findFirst.mock.calls[0][0].where.email).toBe("ariel@ankora.co.il");
    expect(createTask.mock.calls.slice(1).map((c) => c[1].title)).toEqual([...prompts.OFFBOARDING_STEPS]);

    const description = updateTask.mock.calls.find((c) => c[2].description)![2].description;
    expect(description).toContain("לקוח א");
    expect(description).toContain("/app/users/emp");
    expect(description).toContain("noa@example.com");

    const comment = db.taskComment.create.mock.calls[0][0].data;
    expect(comment).toMatchObject({ taskId: "t0", authorId: null });
    expect(comment.body).toContain("passkeys שהוסרו: 2");
    expect(comment.body).toContain("חיבורי Claude שבוטלו: 3");
  });

  it("does not open a second task while one is open, but still revokes", async () => {
    db.task.findMany.mockResolvedValue([{ status: "IN_PROGRESS" }]);
    await expect(lifecycle.runOffboarding(admin, person({ status: "SUSPENDED" }))).resolves.toBeNull();
    expect(createTask).not.toHaveBeenCalled();
    expect(db.passkey.deleteMany).toHaveBeenCalled();
  });

  it("still opens the task when revocation fails, and says so on it", async () => {
    db.passkey.deleteMany.mockRejectedValue(new Error("db down"));
    await lifecycle.runOffboarding(admin, person({ status: "SUSPENDED" }));
    expect(createTask).toHaveBeenCalled();
    expect(db.taskComment.create.mock.calls[0][0].data.body).toContain("נכשלה");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "employee_lifecycle.trigger_failed" }));
  });
});

describe("onConfidentialitySigned (onboarding step 4)", () => {
  beforeEach(() => {
    db.task.findFirst
      .mockResolvedValueOnce({ id: "parent", clientId: "internal" })
      .mockResolvedValueOnce({ id: "step4" });
  });

  it("closes the step when a passkey already exists", async () => {
    db.passkey.count.mockResolvedValue(1);
    await lifecycle.onConfidentialitySigned("emp");
    expect(completeStepAsSystem).toHaveBeenCalledWith("step4", expect.any(String));
    expect(db.task.findFirst.mock.calls[0][0].where).toMatchObject({ subjectUserId: "emp", lifecycleKind: "ONBOARDING" });
    expect(db.task.findFirst.mock.calls[1][0].where.title).toBe(prompts.ONBOARDING_STEPS[3]);
  });

  it("leaves the step open without a passkey, and says which half is done", async () => {
    db.passkey.count.mockResolvedValue(0);
    await lifecycle.onConfidentialitySigned("emp");
    expect(completeStepAsSystem).not.toHaveBeenCalled();
    expect(db.taskComment.create.mock.calls[0][0].data.body).toContain("ה-passkey עדיין לא הוגדר");
  });
});

describe("onConfidentialitySigned without an onboarding task", () => {
  it("does nothing", async () => {
    db.task.findFirst.mockResolvedValue(null);
    await lifecycle.onConfidentialitySigned("emp");
    expect(db.taskComment.create).not.toHaveBeenCalled();
  });
});

describe("onDeletionDeclarationSigned", () => {
  it("comments on the open offboarding task and closes nothing", async () => {
    db.task.findFirst.mockResolvedValue({ id: "off", clientId: "internal" });
    await lifecycle.onDeletionDeclarationSigned("emp", "agr-1");
    expect(db.task.findFirst.mock.calls[0][0].where).toMatchObject({ lifecycleKind: "OFFBOARDING" });
    expect(db.taskComment.create.mock.calls[0][0].data.body).toContain("agr-1");
    expect(completeStepAsSystem).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("onPasskeyRegistered (onboarding step 4, second half)", () => {
  it("closes the step when the in-app signature is already there", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue({ id: "agr" });
    db.task.findFirst.mockResolvedValueOnce({ id: "parent", clientId: "internal" }).mockResolvedValueOnce({ id: "step4" });
    completeStepAsSystem.mockResolvedValue(true);
    await lifecycle.onPasskeyRegistered("emp");
    expect(db.employeeAgreement.findFirst.mock.calls[0][0].where).toMatchObject({ userId: "emp", kind: "CONFIDENTIALITY", channel: "APP" });
    expect(completeStepAsSystem).toHaveBeenCalledWith("step4", expect.any(String));
    expect(db.taskComment.create.mock.calls[0][0].data.body).toContain("השלב נסגר");
  });

  it("does nothing before the signature", async () => {
    db.employeeAgreement.findFirst.mockResolvedValue(null);
    await lifecycle.onPasskeyRegistered("emp");
    expect(db.task.findFirst).not.toHaveBeenCalled();
    expect(completeStepAsSystem).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    db.employeeAgreement.findFirst.mockRejectedValue(new Error("db down"));
    await expect(lifecycle.onPasskeyRegistered("emp")).resolves.toBeUndefined();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "employee_lifecycle.trigger_failed" }));
  });
});

describe("the lifecycle task's category", () => {
  it("uses the named category when it is usable on the internal client", async () => {
    db.category.findFirst.mockResolvedValue({ id: "hr" });
    await lifecycle.openOnboardingTask(admin, person());
    expect(createTask.mock.calls[0][1].categoryId).toBe("hr");
    const where = db.category.findFirst.mock.calls[0][0].where;
    expect(where.name).toEqual({ equals: "גיוס וhr", mode: "insensitive" });
    expect(where.active).toBe(true);
    expect(where.OR).toEqual([{ visibility: "GLOBAL" }, { visibility: "CLIENT", clientId: "internal" }]);
    expect(autoPickCategory).not.toHaveBeenCalled();
  });

  it("reads the name from EMPLOYEE_LIFECYCLE_CATEGORY", async () => {
    process.env.EMPLOYEE_LIFECYCLE_CATEGORY = "אנשים";
    try {
      await lifecycle.openOnboardingTask(admin, person());
      expect(db.category.findFirst.mock.calls[0][0].where.name.equals).toBe("אנשים");
    } finally {
      delete process.env.EMPLOYEE_LIFECYCLE_CATEGORY;
    }
  });

  it("falls back to the automatic pick, but never to a demo category", async () => {
    await lifecycle.openOnboardingTask(admin, person());
    expect(createTask.mock.calls[0][1].categoryId).toBe("cat-1");

    vi.clearAllMocks();
    db.category.findFirst.mockResolvedValue(null);
    autoPickCategory.mockResolvedValue({ id: "demo", name: "[DEMO] פגישות ותיאומים" });
    createTask.mockImplementation(async (_a: unknown, input: { clientId: string }) => ({ id: "t", clientId: input.clientId }));
    await lifecycle.openOnboardingTask(admin, person());
    expect(createTask.mock.calls[0][1].categoryId).toBeNull();
  });
});
