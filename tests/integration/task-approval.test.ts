import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import {
  APPROVAL_WITHOUT_SUPERVISOR_MESSAGE,
  NEEDS_APPROVAL_MESSAGE,
  NOT_THE_SUPERVISOR_MESSAGE,
  createTask,
  getTaskDetail,
  listTasks,
  supervisionCounts,
  updateTask,
} from "@/lib/app-domain/tasks";

// Tasks phase 2 ("מפקח ואישור").
//
// The transition matrix itself is checked in tests/unit/task-approval.ts
// against the rule as a pure function, in milliseconds. What belongs
// here is everything that only exists once a database does:
//
//   - `approvedById` and `approvedAt`, which the server owns and which
//     have to survive, and stop surviving, the right transitions.
//   - The audit action, which the history panel reads and which would
//     otherwise file an approval as an ordinary status change.
//   - Access: a supervisor must be someone who can open the task.
//   - The counts behind the nav row, which decide whether a person ever
//     finds out there is something waiting for them.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

/// A task that needs a signature, with the two people involved.
async function supervised(title = "לתאם מול הספק") {
  const client = await createTestClient();
  const doer = await employeeOn(client.id);
  const boss = await employeeOn(client.id);
  const task = await createTask(doer, {
    clientId: client.id,
    title,
    supervisorId: boss.id,
    requiresApproval: true,
  });
  return { client, doer, boss, task };
}

describe("the signature", () => {
  it("is written on the move out of PENDING_APPROVAL into DONE", async () => {
    const { doer, boss, task } = await supervised();

    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    const approved = await updateTask(boss, task.id, { status: "DONE" });

    expect(approved.approvedById).toBe(boss.id);
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.completedAt).not.toBeNull();
  });

  it("is NOT written when a task closes without ever needing one", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "שיחה אחת" });

    const done = await updateTask(actor, task.id, { status: "DONE" });
    expect(done.approvedById).toBeNull();
    expect(done.approvedAt).toBeNull();
  });

  it("is erased when the task is reopened", async () => {
    // An approval that survived a reopen would be a person's name on
    // work that changed after they signed for it.
    const { doer, boss, task } = await supervised();
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    await updateTask(boss, task.id, { status: "DONE" });

    const reopened = await updateTask(boss, task.id, { status: "IN_PROGRESS" });
    expect(reopened.approvedById).toBeNull();
    expect(reopened.approvedAt).toBeNull();
  });

  it("survives archiving, exactly as the completion does", async () => {
    // Filing finished work away does not unfinish it, and does not
    // unsign it either.
    const { doer, boss, task } = await supervised();
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    await updateTask(boss, task.id, { status: "DONE" });

    const archived = await updateTask(boss, task.id, { status: "ARCHIVED" });
    expect(archived.approvedById).toBe(boss.id);
    expect(archived.completedAt).not.toBeNull();
  });
});

describe("the gate, through the real function", () => {
  it("refuses a supervised task going straight to DONE", async () => {
    const { boss, task } = await supervised();
    await expect(updateTask(boss, task.id, { status: "DONE" })).rejects.toThrow(NEEDS_APPROVAL_MESSAGE);
  });

  it("refuses the person who did the work from approving it", async () => {
    const { doer, task } = await supervised();
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    await expect(updateTask(doer, task.id, { status: "DONE" })).rejects.toThrow(NOT_THE_SUPERVISOR_MESSAGE);
  });

  it("refuses a task created with approval required and no supervisor", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await expect(
      createTask(actor, { clientId: client.id, title: "בלי מפקח", requiresApproval: true })
    ).rejects.toThrow(APPROVAL_WITHOUT_SUPERVISOR_MESSAGE);
  });

  it("lets an admin sign when the supervisor is not around", async () => {
    const { doer, task } = await supervised();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });

    const approved = await updateTask(admin, task.id, { status: "DONE" });
    expect(approved.approvedById).toBe(admin.id);
  });
});

describe("a supervisor has to be able to open the task", () => {
  it("refuses somebody with no access to the client", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const task = await createTask(actor, { clientId: client.id, title: "משימה" });

    // Not a nicety. A supervisor who cannot open the task is either a
    // rubber stamp or a dead end, and the second one means a task nobody
    // can ever close.
    await expect(updateTask(actor, task.id, { supervisorId: stranger.id })).rejects.toThrow();
  });
});

describe("the audit log tells an approval apart from a status change", () => {
  it("records task.approve, not task.status_change", async () => {
    const { doer, boss, task } = await supervised();
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    await updateTask(boss, task.id, { status: "DONE" });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: "Task", entityId: task.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(events.map((e) => e.action)).toEqual(["task.create", "task.status_change", "task.approve"]);
  });

  it("shows the approval as its own line in the task's history", async () => {
    const { doer, boss, task } = await supervised();
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    await updateTask(boss, task.id, { status: "DONE" });

    const detail = await getTaskDetail(boss, task.id);
    expect(detail?.history.map((h) => h.label)).toContain("המשימה אושרה");
  });
});

describe("a task waiting for approval is still open work", () => {
  it("stays on its owner's open list", async () => {
    // The moment somebody sends work for approval is the moment they
    // most need to be able to find it again.
    const { client, doer, task } = await supervised();
    await updateTask(doer, task.id, { assignedToId: doer.id });
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });

    const open = await listTasks(doer, { clientId: client.id, assignedToId: doer.id });
    expect(open.map((t) => t.id)).toContain(task.id);
  });
});

describe("the counts behind the nav row", () => {
  it("counts nothing for somebody who supervises nothing", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    expect(await supervisionCounts(actor)).toEqual({ total: 0, pending: 0 });
  });

  it("separates what is supervised from what is waiting", async () => {
    const { doer, boss, task } = await supervised();
    expect(await supervisionCounts(boss)).toEqual({ total: 1, pending: 0 });

    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    expect(await supervisionCounts(boss)).toEqual({ total: 1, pending: 1 });
  });

  it("stops counting once the work is signed off", async () => {
    // Otherwise the nav row is permanent for anybody who ever supervised
    // anything, and a row that never changes is a row nobody reads.
    const { doer, boss, task } = await supervised();
    await updateTask(doer, task.id, { status: "PENDING_APPROVAL" });
    await updateTask(boss, task.id, { status: "DONE" });

    expect(await supervisionCounts(boss)).toEqual({ total: 0, pending: 0 });
  });
});

describe("the client never sees our internal step", () => {
  it("needs the outcome sentence at submission, not at approval", async () => {
    // The supervisor is about to be asked to sign. Asking THEM for the
    // sentence would put the refusal on the one person who could not
    // have prevented it.
    const client = await createTestClient();
    const doer = await employeeOn(client.id);
    const boss = await employeeOn(client.id);
    const task = await createTask(doer, {
      clientId: client.id,
      title: "הבטחה ללקוח",
      clientVisible: true,
      supervisorId: boss.id,
      requiresApproval: true,
    });

    await expect(updateTask(doer, task.id, { status: "PENDING_APPROVAL" })).rejects.toThrow();

    const sent = await updateTask(doer, task.id, {
      status: "PENDING_APPROVAL",
      clientOutcome: "הספק אישר, מגיע ביום ראשון",
    });
    expect(sent.status).toBe("PENDING_APPROVAL");

    // And the signature then goes through without asking again.
    const approved = await updateTask(boss, task.id, { status: "DONE" });
    expect(approved.approvedById).toBe(boss.id);
  });
});
