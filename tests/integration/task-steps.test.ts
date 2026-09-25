import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import {
  PARENT_CLOSED_MESSAGE,
  PARENT_IS_SUBTASK_MESSAGE,
  PARENT_OTHER_CLIENT_MESSAGE,
  createTask,
  getTaskDetail,
  listMyOpenTasks,
  listTasks,
  stalledPromisesByClient,
  updateTask,
} from "@/lib/app-domain/tasks";
import { buildSummaryDraft, monthRange } from "@/lib/app-domain/portal-summary";

// Tasks phase 5: a task can be a step of another task.
//
// Three things here can only be checked against a database:
//
//   - the refusals, because each one is a query about a row that exists,
//   - the cascade, because it is a transaction,
//   - and the isolation, because it is the same column read by fourteen
//     queries and the only honest way to ask "does a step leak into the
//     client's portal" is to put one there and look.
//
// The unit test beside this one (subtask-isolation) proves every query
// has ANSWERED the question. This proves the answers are right.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

describe("a step belongs to its task, and to one level", () => {
  it("refuses a parent on another client", async () => {
    const a = await createTestClient({ name: "לקוח א" });
    const b = await createTestClient({ name: "לקוח ב" });
    const actor = await employeeOn(a.id);
    await prisma.userClientAccess.create({ data: { userId: actor.id, clientId: b.id } });

    const parent = await createTask(actor, { clientId: a.id, title: "משימה אצל א" });

    await expect(
      createTask(actor, { clientId: b.id, title: "שלב אצל ב", parentId: parent.id })
    ).rejects.toThrow(PARENT_OTHER_CLIENT_MESSAGE);
  });

  it("refuses a step under a step", async () => {
    // One level. A tree is a navigation problem, and the comment on
    // Task.parentId is the argument; this is the enforcement.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const parent = await createTask(actor, { clientId: client.id, title: "משימה" });
    const step = await createTask(actor, { clientId: client.id, title: "שלב", parentId: parent.id });

    await expect(
      createTask(actor, { clientId: client.id, title: "תת שלב", parentId: step.id })
    ).rejects.toThrow(PARENT_IS_SUBTASK_MESSAGE);
  });

  it("refuses a step under a task that is already finished", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const parent = await createTask(actor, { clientId: client.id, title: "משימה" });
    await updateTask(actor, parent.id, { status: "DONE" });

    await expect(
      createTask(actor, { clientId: client.id, title: "מאוחר מדי", parentId: parent.id })
    ).rejects.toThrow(PARENT_CLOSED_MESSAGE);
  });
});

describe("closing a task closes its steps", () => {
  it("closes the open ones, leaves the closed ones alone, and says how many", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const parent = await createTask(actor, { clientId: client.id, title: "משימה" });
    const one = await createTask(actor, { clientId: client.id, title: "א", parentId: parent.id });
    const two = await createTask(actor, { clientId: client.id, title: "ב", parentId: parent.id });
    await updateTask(actor, one.id, { status: "DONE" });

    await updateTask(actor, parent.id, { status: "DONE" });

    const after = await prisma.task.findMany({
      where: { parentId: parent.id },
      select: { id: true, status: true, completedAt: true },
    });
    expect(after.every((t) => t.status === "DONE")).toBe(true);
    expect(after.every((t) => t.completedAt !== null)).toBe(true);

    // And the log says the second one did not close on its own. A step
    // that closes because its task did is a fact somebody will want back
    // when they ask why it is ticked.
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "Task", action: "task.step_closed_with_parent" },
      select: { entityId: true },
    });
    expect(events.map((e) => e.entityId)).toEqual([two.id]);
  });

  it("does not cascade when the task reopens", async () => {
    // Deliberately asymmetric. Closing a task is a statement about the
    // work being over; reopening it is a statement about the task, and
    // re-opening five steps somebody already finished would be a claim
    // nobody made.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const parent = await createTask(actor, { clientId: client.id, title: "משימה" });
    const step = await createTask(actor, { clientId: client.id, title: "שלב", parentId: parent.id });

    await updateTask(actor, parent.id, { status: "DONE" });
    await updateTask(actor, parent.id, { status: "OPEN" });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: step.id } });
    expect(after.status).toBe("DONE");
  });
});

describe("a step is not a task, to anything that counts tasks", () => {
  it("stays out of the task list, and comes back when asked for by parent", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const parent = await createTask(actor, { clientId: client.id, title: "משימה" });
    await createTask(actor, { clientId: client.id, title: "שלב", parentId: parent.id });

    const list = await listTasks(actor, {});
    expect(list.map((t) => t.title)).toEqual(["משימה"]);

    const steps = await listTasks(actor, { parentId: parent.id });
    expect(steps.map((t) => t.title)).toEqual(["שלב"]);
  });

  it("stays out of a person's own open work", async () => {
    // The one that would quietly punish the behaviour the feature is for:
    // a list that grows every time somebody breaks work down is a list
    // that teaches them to stop.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const parent = await createTask(actor, { clientId: client.id, title: "משימה", assignedToId: actor.id });
    await createTask(actor, { clientId: client.id, title: "שלב", parentId: parent.id, assignedToId: actor.id });

    const mine = await listMyOpenTasks(actor);
    expect(mine.map((t) => t.title)).toEqual(["משימה"]);
  });

  it("stays out of the client's portal and out of the manager's number", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const actor = await employeeOn(client.id);
    const yesterday = new Date(Date.now() - 30 * 3600_000);
    const since = new Date(Date.now() - 12 * 3600_000);

    const promise = await createTask(actor, {
      clientId: client.id,
      title: "הבטחה",
      clientVisible: true,
      clientTitle: "מה שהלקוח רואה",
    });
    const step = await createTask(actor, {
      clientId: client.id,
      title: "שלב פנימי",
      parentId: promise.id,
      // Even a step somebody marked client-visible: the portal shows
      // promises, and a step is not one.
      clientVisible: true,
      clientTitle: "שלב שאסור שיופיע",
    });
    await prisma.$executeRaw`UPDATE "tasks" SET "updatedAt" = ${yesterday} WHERE "id" IN (${promise.id}, ${step.id})`;

    const stalled = await stalledPromisesByClient(actor, since);
    expect(stalled.map((r) => [r.clientName, r.count])).toEqual([["אורביט", 1]]);

    const { periodStart, periodEnd } = monthRange(new Date());
    const draft = await buildSummaryDraft(client.id, periodStart, periodEnd);
    expect(JSON.stringify(draft)).not.toContain("שלב שאסור שיופיע");
  });
});

describe("the hours on a task include the hours on its steps", () => {
  it("rolls them up, because that is what somebody asking means", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const category = await prisma.category.create({
      data: { name: "כללי", visibility: "GLOBAL", active: true },
    });
    const parent = await createTask(actor, { clientId: client.id, title: "משימה" });
    const step = await createTask(actor, { clientId: client.id, title: "שלב", parentId: parent.id });

    const base = new Date(Date.now() - 4 * 3600_000);
    for (const [taskId, seconds] of [
      [parent.id, 600],
      [step.id, 1_800],
    ] as const) {
      await prisma.timeEntry.create({
        data: {
          userId: actor.id,
          clientId: client.id,
          categoryId: category.id,
          taskId,
          startAt: base,
          endAt: new Date(base.getTime() + seconds * 1000),
          actualSeconds: seconds,
          billableSeconds: seconds,
        },
      });
    }

    const detail = await getTaskDetail(actor, parent.id);
    // Ten minutes on the task, thirty on the step. A parent reporting
    // ten while the work took forty would be the most confident wrong
    // number on the screen.
    expect(detail!.time.totalSeconds).toBe(2_400);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(["שלב"]);
  });
});
