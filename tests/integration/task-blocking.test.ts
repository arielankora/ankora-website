import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask, stalledPromisesByClient, updateTask } from "@/lib/app-domain/tasks";
import { getPortalTimeline } from "@/lib/app-domain/client-portal";

// Tasks phase 5: what is holding a task up.
//
// The pure rule is checked next door without a database. What needs one
// is everything that makes the feature worth building:
//
//   - the date, which the server owns and must not move,
//   - the metric, which has been unable to tell "stuck on us" from
//     "stuck on them" since the day it was written,
//   - and the portal, because CLIENT is the one blocker a client sees
//     and the other three must stay invisible to them.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

describe("the clock starts once and keeps running", () => {
  it("does not reset when somebody corrects the reason", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "ביקור טכנאי" });

    const blocked = await updateTask(actor, task.id, {
      block: { on: "SUPPLIER", reason: "ההצעה אצלם" },
    });
    expect(blocked.blockedOn).toBe("SUPPLIER");
    expect(blocked.blockedSince).not.toBeNull();

    // Backdated by hand, so the assertion is about the rule and not
    // about two calls landing in the same millisecond.
    const monday = new Date(Date.now() - 6 * 86_400_000);
    await prisma.task.update({ where: { id: task.id }, data: { blockedSince: monday } });

    const corrected = await updateTask(actor, task.id, {
      block: { on: "SUPPLIER", reason: "ההצעה אצלם, נשלחה תזכורת" },
    });
    // The wait began on Monday. A date that moved here would quietly
    // tell everyone the task is six days younger than it is, which is
    // the entire number this feature exists to show.
    expect(corrected.blockedSince?.getTime()).toBe(monday.getTime());
    expect(corrected.blockedReason).toBe("ההצעה אצלם, נשלחה תזכורת");
  });

  it("starts again from today after a block was lifted", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "משימה" });

    await updateTask(actor, task.id, { block: { on: "CLIENT" } });
    await prisma.task.update({
      where: { id: task.id },
      data: { blockedSince: new Date(Date.now() - 10 * 86_400_000) },
    });
    const free = await updateTask(actor, task.id, { block: null });
    expect(free.blockedSince).toBeNull();
    expect(free.blockedReason).toBeNull();

    const again = await updateTask(actor, task.id, { block: { on: "CLIENT" } });
    // A second wait is a second wait. Carrying the first one's date
    // forward would age it by ten days it never spent waiting.
    expect(Date.now() - (again.blockedSince?.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it("stops waiting when the work is finished", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "משימה" });
    await updateTask(actor, task.id, { block: { on: "INTERNAL", reason: "ממתין לאישור של הדס" } });

    const done = await updateTask(actor, task.id, { status: "DONE" });
    expect(done.blockedOn).toBeNull();
    expect(done.blockedSince).toBeNull();
    expect(done.blockedReason).toBeNull();

    // And the close is filed as a close. Naming it "ההמתנה הסתיימה"
    // because a block was cleared on the way would put the event under
    // the wrong verb for whoever reads the history later.
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "Task", entityId: task.id },
      select: { action: true },
    });
    expect(events.map((e) => e.action)).toContain("task.status_change");
    expect(events.map((e) => e.action)).not.toContain("task.unblocked");
  });

  it("writes one line for starting to wait and one for stopping", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "משימה" });

    await updateTask(actor, task.id, { block: { on: "CLIENT" } });
    await updateTask(actor, task.id, { block: null });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: "Task", entityId: task.id, action: { in: ["task.blocked", "task.unblocked"] } },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(events.map((e) => e.action)).toEqual(["task.blocked", "task.unblocked"]);
  });
});

describe("the manager's number stops mixing two different problems", () => {
  it("counts what is stuck on us apart from what is stuck on them", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const actor = await employeeOn(client.id);
    const yesterday = new Date(Date.now() - 30 * 3600_000);
    const since = new Date(Date.now() - 12 * 3600_000);

    const forgotten = await createTask(actor, {
      clientId: client.id,
      title: "נשכחה",
      clientVisible: true,
      clientTitle: "מה שהלקוח רואה",
    });
    const onThem = await createTask(actor, {
      clientId: client.id,
      title: "אצל הלקוח",
      clientVisible: true,
      clientTitle: "מחכה לתשובה שלך",
    });
    const onSupplier = await createTask(actor, {
      clientId: client.id,
      title: "אצל הספק",
      clientVisible: true,
      clientTitle: "מחכה להצעה",
    });

    await updateTask(actor, onThem.id, { block: { on: "CLIENT" } });
    await updateTask(actor, onSupplier.id, { block: { on: "SUPPLIER" } });

    await prisma.$executeRaw`UPDATE "tasks" SET "updatedAt" = ${yesterday} WHERE "id" IN (${forgotten.id}, ${onThem.id}, ${onSupplier.id})`;

    const [row] = await stalledPromisesByClient(actor, since);

    // Two stalled, not three: the forgotten one and the one waiting on
    // a supplier. Chasing that supplier is our job, not the client's,
    // so from where the client sits it is as stalled as the first.
    expect(row.count).toBe(2);
    // And the one the client is sitting on, counted separately. It asks
    // for a reminder, not for work, and a single total that mixes the
    // two is a total nobody can act on.
    expect(row.waiting).toBe(1);
  });

  it("does not call a promise late while the client is holding it", async () => {
    const client = await createTestClient({ name: "לקוח" });
    const actor = await employeeOn(client.id);
    const since = new Date(Date.now() - 12 * 3600_000);

    const task = await createTask(actor, {
      clientId: client.id,
      title: "עברה את התאריך",
      clientVisible: true,
      clientTitle: "מחכה לך",
      dueDate: new Date(Date.now() - 5 * 86_400_000),
    });
    await updateTask(actor, task.id, { block: { on: "CLIENT" } });
    await prisma.$executeRaw`UPDATE "tasks" SET "updatedAt" = ${new Date(Date.now() - 30 * 3600_000)} WHERE "id" = ${task.id}`;

    const [row] = await stalledPromisesByClient(actor, since);
    // Overdue is a number a manager reads as "we are late". We are not:
    // the date passed while the answer sat with the client.
    expect(row.overdue).toBe(0);
    expect(row.waiting).toBe(1);
  });
});

describe("the client sees one blocker and not the other three", () => {
  it("says מחכה לך only when the ball is actually theirs", async () => {
    const client = await createTestClient({ name: "לקוח פורטל" });
    const actor = await employeeOn(client.id);
    const { user: portalUser } = await createTestUser({ role: "CLIENT_USER" });
    await prisma.clientUser.create({ data: { clientId: client.id, userId: portalUser.id, role: "ADMIN" } });

    const theirs = await createTask(actor, {
      clientId: client.id,
      title: "פנימי",
      clientVisible: true,
      clientTitle: "צריך ממך אישור",
    });
    const ours = await createTask(actor, {
      clientId: client.id,
      title: "פנימי אחר",
      clientVisible: true,
      clientTitle: "מחכים להצעה מהספק",
    });
    await updateTask(actor, theirs.id, { block: { on: "CLIENT" } });
    await updateTask(actor, ours.id, {
      status: "IN_PROGRESS",
      block: { on: "SUPPLIER", reason: "ההצעה אצלם מיום ראשון" },
    });

    const home = await getPortalTimeline(portalUser);
    const stages = new Map(home.promises.map((p) => [p.title, p.stage]));

    expect(stages.get("צריך ממך אישור")).toBe("WAITING_ON_CLIENT");
    // Not "מחכה לך". Chasing a supplier is our work, and a client told
    // it is their turn would go looking for something to do.
    expect(stages.get("מחכים להצעה מהספק")).toBe("IN_PROGRESS");
  });

  it("never sends the client the sentence we wrote for ourselves", async () => {
    const client = await createTestClient({ name: "לקוח" });
    const actor = await employeeOn(client.id);
    const { user: portalUser } = await createTestUser({ role: "CLIENT_USER" });
    await prisma.clientUser.create({ data: { clientId: client.id, userId: portalUser.id, role: "ADMIN" } });

    const task = await createTask(actor, {
      clientId: client.id,
      title: "פנימי",
      clientVisible: true,
      clientTitle: "מה שהלקוח רואה",
    });
    // An internal note, in the voice people actually use for one.
    await updateTask(actor, task.id, {
      block: { on: "CLIENT", reason: "לא עונה לטלפון כבר שבוע, לנסות את המשרד" },
    });

    const home = await getPortalTimeline(portalUser);
    expect(JSON.stringify(home)).not.toContain("לא עונה לטלפון");
  });
});
