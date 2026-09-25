import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask, updateTask } from "@/lib/app-domain/tasks";
import { buildDigest } from "@/lib/app-domain/task-digest";

// Hadas, 25.9.2026: a task was opened on her and she did not notice.
//
// The pure halves are checked next door without a database. What needs
// one is whether the bell actually rings, and whether the morning email
// is built from the right rows: both are questions about what is in the
// tables after somebody clicks, and neither can be answered by reading
// the code.

async function staffOn(clientId: string, name: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return { ...user, name };
}

describe("work that lands on somebody rings a bell", () => {
  it("tells the person a task was opened on, at the moment it is opened", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");

    const task = await createTask(hadas, {
      clientId: client.id,
      title: "לתאם ביקור טכנאי",
      assignedToId: anna.id,
    });

    const rows = await prisma.notification.findMany({ where: { userId: anna.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("task_assigned");
    // Openable from the bell. A notification about work that cannot be
    // reached from where it is announced sends somebody to go looking.
    expect(rows[0].entityType).toBe("Task");
    expect(rows[0].entityId).toBe(task.id);
    // The client's name is on it: "לתאם ביקור טכנאי" alone is the same
    // sentence on four different accounts.
    expect(rows[0].body).toContain("אורביט");

    // And nothing for the person who did it.
    expect(await prisma.notification.count({ where: { userId: hadas.id } })).toBe(0);
  });

  it("tells the person work was handed over to, and not the one it left", async () => {
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");

    const task = await createTask(hadas, {
      clientId: client.id,
      title: "משימה",
      assignedToId: hadas.id,
    });
    await updateTask(hadas, task.id, { assignedToId: anna.id });

    expect(await prisma.notification.count({ where: { userId: anna.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: hadas.id } })).toBe(0);
  });

  it("stays quiet when the task is edited but nobody new is named", async () => {
    // The trap: every write persists the whole row, so without a
    // before/after comparison a typo fix would announce the assignee
    // again, every time.
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");

    const task = await createTask(hadas, { clientId: client.id, title: "משימה", assignedToId: anna.id });
    await updateTask(hadas, task.id, { title: "משימה, בשם אחר" });
    await updateTask(hadas, task.id, { priority: "URGENT" });

    expect(await prisma.notification.count({ where: { userId: anna.id } })).toBe(1);
  });
});

describe("what the morning email is built from", () => {
  it("separates late, today, and what arrived since the last email", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);

    const late = await createTask(hadas, {
      clientId: client.id,
      title: "באיחור",
      assignedToId: anna.id,
      dueDate: new Date(now.getTime() - 3 * 24 * 3600_000),
    });
    await createTask(hadas, {
      clientId: client.id,
      title: "להיום",
      assignedToId: anna.id,
      dueDate: now,
    });
    await createTask(hadas, { clientId: client.id, title: "בלי תאריך", assignedToId: anna.id });

    const digest = await buildDigest({ id: anna.id, dailyDigestAt: dayAgo }, now);

    expect(digest.overdue.map((t) => t.title)).toEqual(["באיחור"]);
    expect(digest.today.map((t) => t.title)).toEqual(["להיום"]);
    // All three landed on her since the last email, but the two already
    // named above are not repeated: saying the same task twice in one
    // short email is how a short email stops being short.
    expect(digest.fresh.map((t) => t.title)).toEqual(["בלי תאריך"]);
    expect(digest.overdue[0].clientName).toBe("אורביט");
    expect(digest.overdue[0].id).toBe(late.id);
  });

  it("leaves out what somebody else is holding up", async () => {
    // Same call the manager's stalled number makes: a task waiting on a
    // client is not a task this person failed to do today, and putting
    // it under "באיחור" is the email blaming them for someone else.
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");
    const now = new Date();

    const task = await createTask(hadas, {
      clientId: client.id,
      title: "ממתין ללקוח",
      assignedToId: anna.id,
      dueDate: new Date(now.getTime() - 3 * 24 * 3600_000),
    });
    await updateTask(hadas, task.id, { block: { on: "CLIENT" } });

    const digest = await buildDigest({ id: anna.id, dailyDigestAt: new Date(now.getTime() - 3600_000) }, now);
    expect(digest.overdue).toEqual([]);
    expect(digest.today).toEqual([]);
  });

  it("counts a wait that has gone on too long, as one sentence", async () => {
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");
    const now = new Date();

    const task = await createTask(hadas, { clientId: client.id, title: "ממתין מזמן", assignedToId: anna.id });
    await updateTask(hadas, task.id, { block: { on: "SUPPLIER" } });
    await prisma.task.update({
      where: { id: task.id },
      data: { blockedSince: new Date(now.getTime() - 9 * 24 * 3600_000) },
    });

    const digest = await buildDigest({ id: anna.id, dailyDigestAt: now }, now);
    expect(digest.staleWaits).toBe(1);
  });

  it("carries what is stopped on this person's signature", async () => {
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");
    const now = new Date();

    const task = await createTask(hadas, {
      clientId: client.id,
      title: "מחכה לחתימה",
      assignedToId: anna.id,
      supervisorId: hadas.id,
      requiresApproval: true,
    });
    await updateTask(anna, task.id, { status: "PENDING_APPROVAL" });

    const digest = await buildDigest({ id: hadas.id, dailyDigestAt: now }, now);
    expect(digest.awaitingMySignature.map((t) => t.title)).toEqual(["מחכה לחתימה"]);
  });

  it("does not list a task that moved on between the bell and the morning", async () => {
    // The notification row is a record of what happened last night, not
    // a promise about this morning. A task closed overnight, or handed
    // to somebody else, must not appear in an email telling this person
    // it is theirs.
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const anna = await staffOn(client.id, "אנה");
    const now = new Date();

    const task = await createTask(hadas, { clientId: client.id, title: "נסגרה בלילה", assignedToId: anna.id });
    await updateTask(hadas, task.id, { status: "DONE" });

    const digest = await buildDigest({ id: anna.id, dailyDigestAt: new Date(now.getTime() - 3600_000) }, now);
    expect(digest.fresh).toEqual([]);
  });
});
