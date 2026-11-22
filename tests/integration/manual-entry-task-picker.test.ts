import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import { listOpenTasksForTimeEntry } from "@/lib/app-domain/tasks";
import { createManualEntry } from "@/lib/app-domain/time-entries";

// 17.11.2026: the one-line manual entry on "הזמן שלי" offers the picked
// client's open tasks, so time is reported straight against a task.
//
// Two things the screen is only as correct as: the list it is handed,
// and the write it sends with a task and no note.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

function pastWindow(hours = 1) {
  const endAt = new Date(Date.now() - 10 * 60_000);
  return { startAt: new Date(endAt.getTime() - hours * 3600_000), endAt };
}

describe("listOpenTasksForTimeEntry", () => {
  it("offers every open task on the person's clients, internal ones too, and nothing else", async () => {
    const mine = await createTestClient({ name: "שלי" });
    const notMine = await createTestClient({ name: "לא שלי" });
    const actor = await employeeOn(mine.id);
    const category = await createTestCategory();

    const internal = await prisma.task.create({
      data: { clientId: mine.id, title: "פנימית", clientVisible: false, categoryId: category.id },
    });
    const visible = await prisma.task.create({
      data: { clientId: mine.id, title: "גלויה", clientVisible: true, status: "IN_PROGRESS" },
    });
    await prisma.task.create({ data: { clientId: mine.id, title: "סגורה", status: "DONE" } });
    await prisma.task.create({ data: { clientId: mine.id, title: "שלב", parentId: internal.id } });
    await prisma.task.create({
      data: { clientId: mine.id, title: "נמחקה", deletedAt: new Date() },
    });
    await prisma.task.create({ data: { clientId: notMine.id, title: "של לקוח אחר" } });

    const rows = await listOpenTasksForTimeEntry(actor);

    expect(rows.map((r) => r.id).sort()).toEqual([internal.id, visible.id].sort());
    expect(rows.find((r) => r.id === internal.id)?.categoryId, "the form fills the category from it").toBe(
      category.id
    );
  });

  // 22.11.2026: the timer's task picker reads the same list. It needs to
  // know which tasks the client sees (only those get the stage question
  // at the stop) and the name the client knows them by.
  it("says which tasks the client sees and what the client calls them", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);

    const internal = await prisma.task.create({
      data: { clientId: client.id, title: "פנימית", clientVisible: false },
    });
    const visible = await prisma.task.create({
      data: { clientId: client.id, title: "שם פנימי", clientTitle: "שם ללקוח", clientVisible: true },
    });

    const rows = await listOpenTasksForTimeEntry(actor);

    expect(rows.find((r) => r.id === internal.id)).toMatchObject({ clientVisible: false });
    expect(rows.find((r) => r.id === visible.id)).toMatchObject({ clientVisible: true, clientTitle: "שם ללקוח" });
  });
});

describe("a manual entry against a task", () => {
  it("is saved with the task and needs no note", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const category = await createTestCategory();
    const task = await prisma.task.create({ data: { clientId: client.id, title: "דוח חודשי" } });

    const entry = await createManualEntry(actor, actor.id, {
      clientId: client.id,
      categoryId: category.id,
      taskId: task.id,
      ...pastWindow(1),
      note: "",
      backdateReason: "fixture: window in the past",
    });

    expect(entry.taskId).toBe(task.id);
  });

  it("refuses a task of another client, in words", async () => {
    const client = await createTestClient();
    const other = await createTestClient({ name: "אחר" });
    const actor = await employeeOn(client.id);
    const category = await createTestCategory();
    const task = await prisma.task.create({ data: { clientId: other.id, title: "לא כאן" } });

    await expect(
      createManualEntry(actor, actor.id, {
        clientId: client.id,
        categoryId: category.id,
        taskId: task.id,
        ...pastWindow(1),
        note: "עבודה",
        backdateReason: "fixture: window in the past",
      })
    ).rejects.toMatchObject({ code: "timeEntries.taskOtherClient" });
  });
});
