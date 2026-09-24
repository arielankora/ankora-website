import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestTimeEntry, createTestUser } from "./factories";
import { clientTaskOverview, createTask } from "@/lib/app-domain/tasks";

// Hadas, 23.9.2026: the tasks panel on the client screen.
//
// What matters here is what the panel refuses to show: another client's
// tasks, closed tasks in the open list, and deleted time in the hours.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

describe("clientTaskOverview()", () => {
  it("lists only this client's open tasks, with the hours reported on each", async () => {
    const client = await createTestClient();
    const other = await createTestClient();
    const category = await createTestCategory();
    const actor = await employeeOn(client.id);
    await prisma.userClientAccess.create({ data: { userId: actor.id, clientId: other.id } });

    const open = await createTask(actor, { clientId: client.id, title: "פתוחה" });
    const done = await createTask(actor, { clientId: client.id, title: "סגורה" });
    await prisma.task.update({ where: { id: done.id }, data: { status: "DONE", completedAt: new Date() } });
    await createTask(actor, { clientId: other.id, title: "של לקוח אחר" });

    const entry = await createTestTimeEntry({ userId: actor.id, clientId: client.id, categoryId: category.id });
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { taskId: open.id } });

    const overview = await clientTaskOverview(actor, client.id);

    expect(overview.open.map((t) => t.title)).toEqual(["פתוחה"]);
    expect(overview.openCount).toBe(1);
    expect(overview.closedRecently).toBe(1);
    expect(overview.hoursByTask.get(open.id)).toBe(3600);
  });

  it("returns nothing for a client the actor cannot reach, instead of every client they can", async () => {
    const mine = await createTestClient();
    const theirs = await createTestClient();
    const actor = await employeeOn(mine.id);
    await createTask(actor, { clientId: mine.id, title: "שלי" });

    const overview = await clientTaskOverview(actor, theirs.id);

    expect(overview.open).toEqual([]);
    expect(overview.openCount).toBe(0);
  });

  it("counts this month's time that was reported against no task", async () => {
    const client = await createTestClient();
    const category = await createTestCategory();
    const actor = await employeeOn(client.id);
    const now = new Date();
    await createTestTimeEntry({
      userId: actor.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(now.getTime() - 30 * 60_000),
      endAt: new Date(now.getTime() - 10 * 60_000),
    });

    const overview = await clientTaskOverview(actor, client.id, now);

    expect(overview.untaskedSecondsThisMonth).toBe(20 * 60);
  });
});
