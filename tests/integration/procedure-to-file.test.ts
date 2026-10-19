import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask } from "@/lib/app-domain/tasks";
import { procedureReminderFor } from "@/lib/app-domain/procedure-to-file";

// 19.10.2026: closing a task that produced a procedure, or that mapped
// something, reminds when nothing was proposed to the client file from
// it. Against a real database because the answer depends on three tables
// (documents, the source register, proposal batches) and on the JSON refs
// that tie them together.

async function setup(description?: string) {
  const client = await createTestClient();
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  const task = await createTask(user, { clientId: client.id, title: "ניהול Google Workspace", description });
  return { client, user, task };
}

async function fileDocument(clientId: string, taskId: string, kind: "POLICY" | "OTHER") {
  return prisma.clientDocument.create({
    data: { clientId, taskId, title: "נוהל", kind, driveFileId: `drive-${Math.random()}`, mimeType: "application/pdf", clientVisible: false },
  });
}

async function proposeFrom(clientId: string, ref: { system: "DOCUMENT" | "TASK"; id: string }, seq = 1) {
  const source = await prisma.clientSource.create({
    data: {
      clientId,
      seq,
      code: `S${seq}`,
      kind: ref.system === "TASK" ? "TASK" : "ANKORA_DOCUMENT",
      title: "מקור",
      externalRefs: [ref],
    },
  });
  await prisma.knowledgeBatch.create({ data: { clientId, sourceId: source.id } });
  return source;
}

describe("procedureReminderFor()", () => {
  it("reminds when a task with a policy document closes and nothing was proposed from it", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "POLICY");
    const r = await procedureReminderFor(task.id, "DONE");
    expect(r?.kind).toBe("PROCEDURE");
    expect(r?.forClaude).toContain(`documentId ${doc.id}`);
    expect(r?.forScreen).toContain("תיק הלקוח");
  });

  it("reminds on PENDING_APPROVAL too, and never on other moves", async () => {
    const { client, task } = await setup();
    await fileDocument(client.id, task.id, "POLICY");
    expect((await procedureReminderFor(task.id, "PENDING_APPROVAL"))?.kind).toBe("PROCEDURE");
    expect(await procedureReminderFor(task.id, "IN_PROGRESS")).toBeNull();
    expect(await procedureReminderFor(task.id, "ARCHIVED")).toBeNull();
    expect(await procedureReminderFor(task.id, undefined)).toBeNull();
  });

  it("is quiet once a batch was proposed from the document", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "POLICY");
    await proposeFrom(client.id, { system: "DOCUMENT", id: doc.id });
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("a source registered but never used does not count", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "POLICY");
    await prisma.clientSource.create({
      data: { clientId: client.id, seq: 1, code: "S1", kind: "ANKORA_DOCUMENT", title: "מקור", externalRefs: [{ system: "DOCUMENT", id: doc.id }] },
    });
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("PROCEDURE");
  });

  it("ignores documents that are not policies", async () => {
    const { client, task } = await setup();
    await fileDocument(client.id, task.id, "OTHER");
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("reminds on a mapping task without any document, and a proposal from the task quiets it", async () => {
    const { client, task } = await setup("פרטים\n\n**HND-029** | שלב: מיפוי וצפייה | מאשר: אריאל");
    const r = await procedureReminderFor(task.id, "DONE");
    expect(r?.kind).toBe("MAPPING");
    expect(r?.forClaude).toContain(`taskId ${task.id}`);
    await proposeFrom(client.id, { system: "TASK", id: task.id });
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("a proposal from another client's task with the same id shape does not count", async () => {
    const { client, task } = await setup();
    await fileDocument(client.id, task.id, "POLICY");
    const other = await createTestClient();
    await proposeFrom(other.id, { system: "TASK", id: task.id });
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("PROCEDURE");
  });
});
