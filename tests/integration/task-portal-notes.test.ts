import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";
import { addTaskPortalNote, listTaskPortalNotes, removeTaskPortalNote } from "@/lib/app-domain/task-portal-notes";
import { getPortalHome } from "@/lib/app-domain/client-portal";

// 4.11.2026 ("סמן הודעות"): the lines a client reads under a task. What
// matters is where they may NOT go: a task the client cannot see, a client
// the person does not work on, and back onto the portal once removed.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

async function seedTask(clientId: string, clientVisible = true) {
  return prisma.task.create({ data: { clientId, title: "תיאום פגישות · נובמבר", clientVisible, status: "IN_PROGRESS" } });
}

describe("task portal notes", () => {
  it("adds a line the client sees under the task on their portal, in order", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const { user: viewer } = await createTestClientUser({ clientId: client.id });
    const task = await seedTask(client.id);

    await addTaskPortalNote(actor, task.id, "רותם כהן · פגישה ברביעי 11.11 ב-11:00");
    await addTaskPortalNote(actor, task.id, "יעל ברק\nפגישה בשלישי 10.11");

    const home = await getPortalHome(viewer);
    expect(home.inProgress[0].notes).toEqual(["רותם כהן · פגישה ברביעי 11.11 ב-11:00", "יעל ברק פגישה בשלישי 10.11"]);
    const audit = await prisma.auditEvent.count({ where: { action: "task.portal_note_add", entityId: task.id } });
    expect(audit).toBe(2);
  });

  it("refuses a task the client cannot see", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, false);
    await expect(addTaskPortalNote(actor, task.id, "שורה")).rejects.toThrow("לא מוצגת ללקוח");
    expect(await prisma.taskPortalNote.count()).toBe(0);
  });

  it("refuses a person who does not work on the client", async () => {
    const client = await createTestClient();
    const other = await createTestClient();
    const outsider = await employeeOn(other.id);
    const task = await seedTask(client.id);
    await expect(addTaskPortalNote(outsider, task.id, "שורה")).rejects.toThrow();
    await expect(listTaskPortalNotes(outsider, task.id)).rejects.toThrow();
  });

  it("takes a removed line off the portal, and only its writer or an editor of others may remove it", async () => {
    const client = await createTestClient();
    const writer = await employeeOn(client.id);
    const colleague = await employeeOn(client.id);
    const { user: viewer } = await createTestClientUser({ clientId: client.id });
    const task = await seedTask(client.id);
    const note = await addTaskPortalNote(writer, task.id, "רותם כהן · פגישה");

    await expect(removeTaskPortalNote(colleague, note.id)).rejects.toThrow("אפשר להסיר רק שורות שכתבתם");
    await removeTaskPortalNote(writer, note.id);

    const home = await getPortalHome(viewer);
    expect(home.inProgress[0].notes).toEqual([]);
    expect(await listTaskPortalNotes(writer, task.id)).toEqual([]);
  });
});
