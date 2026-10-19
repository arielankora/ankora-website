import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient } from "./factories";
import { createImportantDate, updateImportantDate } from "@/lib/app-domain/important-dates";
import { createDueAutoTasks } from "@/lib/app-domain/important-dates-job";

// Spec 3.10, "ממתין לקבלה": a date on which something is due to reach us.
// The task it opens asks to make sure it came, and says from whom.

describe("a date that expects something", () => {
  it("opens a task to make sure it arrived, and stops when unmarked", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();
    const date = await createImportantDate(admin, {
      clientId: client.id,
      title: "דוח ספקים פתוחים",
      type: "מועד כללי",
      category: "GENERAL",
      month: new Date().getUTCMonth() + 1,
      day: new Date().getUTCDate(),
      responsibleUserId: admin.id,
      createAutoTask: true,
      autoTaskLeadDays: 0,
      expectsReceipt: true,
      expectedFrom: " איילה, Nextage ",
    });
    expect(await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } })).toMatchObject({ expectsReceipt: true, expectedFrom: "איילה, Nextage" });

    await createDueAutoTasks(date.nextOccurrenceAt!);
    const task = await prisma.task.findFirstOrThrow({ where: { importantDateId: date.id } });
    expect(task.title).toBe("לוודא שהתקבל: דוח ספקים פתוחים (מ-איילה, Nextage)");

    const row = await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } });
    await updateImportantDate(admin, date.id, { expectsReceipt: false, expectedFrom: "מישהו", expectedUpdatedAt: row.updatedAt });
    expect(await prisma.importantDate.findUniqueOrThrow({ where: { id: date.id } })).toMatchObject({ expectsReceipt: false, expectedFrom: null });
  });
});
