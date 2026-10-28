import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import { getTaskDetail, listTasks, updateTask } from "@/lib/app-domain/tasks";
import { lookupClient, lookupTask, lookupTaskById } from "@/lib/mcp/lookup";
import { redactEntriesForAi } from "@/lib/mcp/ai-redact";
import { findDocumentForMcp, listDocumentsForMcp } from "@/lib/app-domain/mcp-files";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { extractionBrief } from "@/lib/app-domain/extraction-brief";
import { advancePromptFor } from "@/lib/app-domain/advance-prompt-input";
import { extractPromptFor } from "@/lib/app-domain/extract-prompt-input";
import { updateClient } from "@/lib/app-domain/clients";
import { AI_EXCLUDED_TOOL_MESSAGE, AI_EXCLUSION_CLEAR_FORBIDDEN_MESSAGE, AI_EXCLUSION_ON_STEP_MESSAGE, AiExcludedError } from "@/lib/ai-exclusion";

// "בלי AI" (28.10.2026): any staff member on the client marks, only a
// manager clears, a step inherits instead of carrying its own mark, and
// every mark and clear is its own line in the audit log.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  const task = await prisma.task.create({ data: { clientId: client.id, title: "חוזה עם ספק" } });
  const step = await prisma.task.create({ data: { clientId: client.id, title: "לקרוא את החוזה", parentId: task.id } });
  return { client, hadas, ariel, task, step };
}

const actions = (entityId: string) =>
  prisma.auditEvent.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true } }).then((r) => r.map((e) => e.action));

describe("בלי AI", () => {
  it("an employee marks a task, and only a manager clears it", async () => {
    const { hadas, ariel, task } = await setup();

    await updateTask(hadas, task.id, { aiExcluded: true });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).aiExcluded).toBe(true);

    await expect(updateTask(hadas, task.id, { aiExcluded: false })).rejects.toThrow(AI_EXCLUSION_CLEAR_FORBIDDEN_MESSAGE);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).aiExcluded).toBe(true);

    await updateTask(ariel, task.id, { aiExcluded: false });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).aiExcluded).toBe(false);

    expect(await actions(task.id)).toEqual(["task.ai_excluded", "task.ai_included"]);
  });

  it("a step is not marked on its own", async () => {
    const { hadas, step } = await setup();
    await expect(updateTask(hadas, step.id, { aiExcluded: true })).rejects.toThrow(AI_EXCLUSION_ON_STEP_MESSAGE);
  });

  it("an unchanged mark writes nothing", async () => {
    const { hadas, task } = await setup();
    await updateTask(hadas, task.id, { aiExcluded: false });
    expect(await actions(task.id)).toEqual([]);
  });

  it("marking a client is logged on its own line", async () => {
    const { ariel, client } = await setup();
    await updateClient(ariel, client.id, { aiExcluded: true });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).aiExcluded).toBe(true);
    expect(await actions(client.id)).toEqual(["client.settings_change", "client.ai_excluded"]);
  });
});

// Step 2: nothing marked reaches a prompt. A marked task, a step under it
// and every task of a marked client get no "קדם עם קלוד" prompt at all; a
// document marked on its own is left out of an unmarked task's prompt.
describe("בלי AI in the prompts", () => {
  const prompt = async (actor: Parameters<typeof advancePromptFor>[0], taskId: string) =>
    advancePromptFor(actor, (await getTaskDetail(actor, taskId))!, null);

  it("a marked task and its step get no prompt", async () => {
    const { hadas, task, step } = await setup();
    expect(await prompt(hadas, task.id)).toContain(task.title);

    await updateTask(hadas, task.id, { aiExcluded: true });
    expect(await prompt(hadas, task.id)).toBeNull();
    expect(await prompt(hadas, step.id)).toBeNull();
  });

  it("no task of a marked client gets a prompt, and neither does its file", async () => {
    const { ariel, hadas, client, task } = await setup();
    expect(await extractPromptFor(ariel, client.id)).not.toBeNull();

    await updateClient(ariel, client.id, { aiExcluded: true });
    expect(await prompt(hadas, task.id)).toBeNull();
    expect(await extractPromptFor(ariel, client.id)).toBeNull();
  });

  it("a marked document is left out of an unmarked task's prompt", async () => {
    const { hadas, client, task } = await setup();
    const doc = (title: string, aiExcluded: boolean) =>
      prisma.clientDocument.create({ data: { clientId: client.id, taskId: task.id, title, driveFileId: `drive-${title}`, mimeType: "application/pdf", aiExcluded } });
    await doc("הצעת מחיר", false);
    await doc("חוזה רגיש", true);

    const text = await prompt(hadas, task.id);
    expect(text).toContain("הצעת מחיר");
    expect(text).not.toContain("חוזה רגיש");
  });
});

// Step 3: the MCP tools. What each tool calls, against a real database:
// the lookups, the task list, the time entries, the documents, the client
// file and the extraction brief.
describe("בלי AI in the MCP layer", () => {
  it("a marked client and a marked task are no candidates, and say why", async () => {
    const { ariel, hadas, client, task, step } = await setup();
    const other = await prisma.task.create({ data: { clientId: client.id, title: "חשבונית חודשית" } });
    await updateTask(hadas, task.id, { aiExcluded: true });

    expect((await lookupTask(hadas, "חוזה עם ספק")).ok).toBe(false);
    expect(await lookupTask(hadas, "חוזה עם ספק")).toEqual({ ok: false, message: AI_EXCLUDED_TOOL_MESSAGE });
    expect(await lookupTaskById(hadas, task.id)).toEqual({ ok: false, message: AI_EXCLUDED_TOOL_MESSAGE });
    expect(await lookupTaskById(hadas, step.id)).toEqual({ ok: false, message: AI_EXCLUDED_TOOL_MESSAGE });
    expect((await lookupTaskById(hadas, other.id)).ok).toBe(true);
    expect((await listTasks(hadas, { forAi: true })).map((t) => t.id)).toEqual([other.id]);

    await updateClient(ariel, client.id, { aiExcluded: true });
    expect(await lookupClient(hadas, "NUX")).toEqual({ ok: false, message: AI_EXCLUDED_TOOL_MESSAGE });
    expect(await lookupTaskById(hadas, other.id)).toEqual({ ok: false, message: AI_EXCLUDED_TOOL_MESSAGE });
    expect(await listTasks(hadas, { forAi: true })).toEqual([]);
  });

  it("time on a marked task keeps its minutes and loses its title and note", async () => {
    const { hadas, client, task } = await setup();
    const category = await createTestCategory({ clientId: client.id });
    const entry = await prisma.timeEntry.create({
      data: { userId: hadas.id, clientId: client.id, categoryId: category.id, taskId: task.id, startAt: new Date("2026-10-27T08:00:00Z"), endAt: new Date("2026-10-27T09:00:00Z"), actualSeconds: 3600, billableSeconds: 3600, note: "קראתי את החוזה" },
      include: { task: true, client: true },
    });
    await updateTask(hadas, task.id, { aiExcluded: true });

    const [shown] = await redactEntriesForAi([entry]);
    expect(shown.aiExcluded).toBe(true);
    expect(shown.entry.note).toBeNull();
    expect(shown.entry.task).toBeNull();
    expect(shown.entry.billableSeconds).toBe(3600);
  });

  it("a marked document is not listed and not read", async () => {
    const { hadas, client } = await setup();
    const doc = (title: string, aiExcluded: boolean) =>
      prisma.clientDocument.create({ data: { clientId: client.id, title, driveFileId: `drive-${title}`, mimeType: "application/pdf", aiExcluded } });
    const open = await doc("הצעת מחיר", false);
    const marked = await doc("חוזה רגיש", true);

    expect((await listDocumentsForMcp(hadas, { clientId: client.id })).map((d) => d.id)).toEqual([open.id]);
    expect((await findDocumentForMcp(hadas, open.id))?.id).toBe(open.id);
    await expect(findDocumentForMcp(hadas, marked.id)).rejects.toThrow(AiExcludedError);
  });

  it("the client file is not built for AI on a marked client, and the extraction brief says to skip it", async () => {
    const { ariel, client } = await setup();
    await expect(buildClientFile(ariel, client.id, { audience: "ai" })).resolves.toBeTruthy();

    await updateClient(ariel, client.id, { aiExcluded: true });
    await expect(buildClientFile(ariel, client.id, { audience: "ai" })).rejects.toThrow(AiExcludedError);
    await expect(buildClientFile(ariel, client.id, { audience: "staff" })).resolves.toBeTruthy();

    const brief = await extractionBrief(ariel);
    const row = brief.clients.find((c) => c.name === "NUX");
    expect(row).toMatchObject({ aiExcluded: true });
    expect(row).not.toHaveProperty("dataHandlingRules");
  });
});
