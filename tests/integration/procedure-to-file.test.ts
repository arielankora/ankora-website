import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask, updateTask } from "@/lib/app-domain/tasks";
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

async function fileDocument(clientId: string, taskId: string, kind: "PROCEDURE" | "POLICY" | "OTHER", title = "מסמך") {
  return prisma.clientDocument.create({
    data: { clientId, taskId, title, kind, driveFileId: `drive-${Math.random()}`, mimeType: "application/pdf", clientVisible: false },
  });
}

async function proposeFrom(
  clientId: string,
  ref: { system: "DOCUMENT" | "TASK"; id: string },
  seq = 1,
  states: ("PENDING" | "APPROVED" | "REJECTED")[] = ["PENDING"]
) {
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
  const batch = await prisma.knowledgeBatch.create({ data: { clientId, sourceId: source.id } });
  for (const state of states) {
    await prisma.knowledgeProposal.create({ data: { batchId: batch.id, clientId, target: "PROCESS", payload: { title: "תהליך" }, state } });
  }
  return source;
}

describe("procedureReminderFor()", () => {
  it("reminds when a task with a policy document closes and nothing was proposed from it", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "PROCEDURE");
    const r = await procedureReminderFor(task.id, "DONE");
    expect(r?.kind).toBe("PROCEDURE");
    expect(r?.forClaude).toContain(`documentId ${doc.id}`);
    expect(r?.forScreen).toContain("תיק הלקוח");
  });

  it("reminds on PENDING_APPROVAL too, and never on other moves", async () => {
    const { client, task } = await setup();
    await fileDocument(client.id, task.id, "PROCEDURE");
    expect((await procedureReminderFor(task.id, "PENDING_APPROVAL"))?.kind).toBe("PROCEDURE");
    expect(await procedureReminderFor(task.id, "IN_PROGRESS")).toBeNull();
    expect(await procedureReminderFor(task.id, "ARCHIVED")).toBeNull();
    expect(await procedureReminderFor(task.id, undefined)).toBeNull();
  });

  it("is quiet once a batch was proposed from the document", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "PROCEDURE");
    await proposeFrom(client.id, { system: "DOCUMENT", id: doc.id });
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("a batch whose every proposal was rejected does not count, one still standing does (20.10.2026)", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "PROCEDURE");
    await proposeFrom(client.id, { system: "DOCUMENT", id: doc.id }, 1, ["REJECTED", "REJECTED"]);
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("PROCEDURE");
    await proposeFrom(client.id, { system: "DOCUMENT", id: doc.id }, 2, ["REJECTED", "APPROVED"]);
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("a batch with nothing in it does not count", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "PROCEDURE");
    await proposeFrom(client.id, { system: "DOCUMENT", id: doc.id }, 1, []);
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("PROCEDURE");
  });

  it("a source registered but never used does not count", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "PROCEDURE");
    await prisma.clientSource.create({
      data: { clientId: client.id, seq: 1, code: "S1", kind: "ANKORA_DOCUMENT", title: "מקור", externalRefs: [{ system: "DOCUMENT", id: doc.id }] },
    });
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("PROCEDURE");
  });

  it("ignores documents that are not procedures, an insurance policy included", async () => {
    const { client, task } = await setup();
    await fileDocument(client.id, task.id, "OTHER", "חשבונית ספטמבר");
    await fileDocument(client.id, task.id, "POLICY", "פוליסת ביטוח צד ג");
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("catches a procedure filed as another kind by its name, and says it was misfiled (20.10.2026)", async () => {
    const { client, task } = await setup();
    const doc = await fileDocument(client.id, task.id, "OTHER", "נוהל טיפול בתקלות ציוד");
    const r = await procedureReminderFor(task.id, "DONE");
    expect(r?.kind).toBe("PROCEDURE");
    expect(r?.forClaude).toContain(`documentId ${doc.id}`);
    expect(r?.forScreen).toContain('לשנות אותו ל"נוהל"');
  });

  it("reminds on a task marked as mapping, whatever its description says (20.10.2026)", async () => {
    const { task } = await setup("מיפוי של מערכות, בלי שורת ההעברה");
    expect(task.mappingTask).toBe(false);
    await prisma.task.update({ where: { id: task.id }, data: { mappingTask: true } });
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("MAPPING");
  });

  it("marks a task created with the handover's mapping line, and not one without it", async () => {
    const { task: mapping } = await setup("**HND-029** | שלב: מיפוי וצפייה");
    const { task: plain } = await setup("משימה רגילה");
    expect(mapping.mappingTask).toBe(true);
    expect(plain.mappingTask).toBe(false);
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
    await fileDocument(client.id, task.id, "PROCEDURE");
    const other = await createTestClient();
    await proposeFrom(other.id, { system: "TASK", id: task.id });
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("PROCEDURE");
  });

  it("updateTask: a rewritten description turns the flag on, and only the flag itself turns it off", async () => {
    const { user, task } = await setup("משימה רגילה");
    const on = await updateTask(user, task.id, { description: "**HND-031** | שלב: מיפוי וצפייה" });
    expect(on.mappingTask).toBe(true);
    const reworded = await updateTask(user, task.id, { description: "בלי השורה" });
    expect(reworded.mappingTask).toBe(true);
    const off = await updateTask(user, task.id, { mappingTask: false });
    expect(off.mappingTask).toBe(false);
  });

  it("the flag decides: switched off, a task whose description still has the line is quiet (20.10.2026)", async () => {
    const { user, task } = await setup("**HND-032** | שלב: מיפוי וצפייה");
    expect((await procedureReminderFor(task.id, "DONE"))?.kind).toBe("MAPPING");
    await updateTask(user, task.id, { mappingTask: false });
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });

  it("a description that only quotes the stage does not mark the task", async () => {
    const { task } = await setup('הזיהוי מתבסס על השורה "שלב: מיפוי וצפייה" בתיאור.');
    expect(task.mappingTask).toBe(false);
    expect(await procedureReminderFor(task.id, "DONE")).toBeNull();
  });
});
