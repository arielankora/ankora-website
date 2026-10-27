import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { updateTask } from "@/lib/app-domain/tasks";
import { updateClient } from "@/lib/app-domain/clients";
import { AI_EXCLUSION_CLEAR_FORBIDDEN_MESSAGE, AI_EXCLUSION_ON_STEP_MESSAGE } from "@/lib/ai-exclusion";

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
