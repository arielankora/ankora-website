import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientFact } from "@/lib/app-domain/client-facts";
import { ATTENTION_TYPE, notifyClientFileAttention } from "@/lib/app-domain/client-file-attention";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 5.4): the
// daily look at every client file.
//
// What is worth holding here: the account manager hears about everything,
// a question's assignee about their questions, nobody hears twice in a
// week unless something new expired, and a client with nobody to tell is
// counted rather than lost.

const DAY = 24 * 60 * 60 * 1000;

async function setup(withManager = true) {
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const client = await createTestClient({ name: "NUX" });
  if (withManager) await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: manager.id } });
  for (const u of [manager, hadas]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה" });
  return { client, manager, hadas };
}

const S1 = [{ code: "S1" }];

describe("client file attention", () => {
  it("tells the manager everything and the assignee their questions, once a week", async () => {
    const { client, manager, hadas } = await setup();
    await addClientFact(hadas, { clientId: client.id, kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי", validUntil: new Date("2026-10-01T00:00:00Z"), sources: S1 });
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "מי מורשה החתימה?", assigneeId: hadas.id });
    const stale = await addClientFact(hadas, { clientId: client.id, kind: "FINANCE", body: "מגבלת Justworks", knowledgeStatus: "UNCERTAIN", toResolve: "אישור בכתב", sources: S1 });
    await prisma.clientFact.update({ where: { id: stale.id }, data: { updatedAt: new Date("2026-09-01T00:00:00Z") } });

    const now = new Date("2026-10-14T05:00:00Z");
    expect(await notifyClientFileAttention(now)).toEqual({ notified: 2, unowned: 0 });

    const toManager = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: ATTENTION_TYPE } });
    expect(toManager.entityType).toBe("Client");
    expect(toManager.entityId).toBe(client.id);
    expect(toManager.body).toContain("עבר את התוקף");
    expect(toManager.body).toContain("שאלה פתוחה");
    expect(toManager.body).toContain("לא ודאי");
    const toHadas = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: ATTENTION_TYPE } });
    expect(toHadas.body).toBe("שאלה פתוחה אחת עדיין בלי תשובה.");

    // The next morning: nothing new, nobody hears again.
    expect((await notifyClientFileAttention(new Date(now.getTime() + DAY))).notified).toBe(0);
    // A week later, they do.
    expect((await notifyClientFileAttention(new Date(now.getTime() + 8 * DAY))).notified).toBe(2);
  });

  it("a temporary item that expires after the last notice is news the next morning", async () => {
    const { client, manager, hadas } = await setup();
    const now = new Date("2026-10-14T05:00:00Z");
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "שאלה", assigneeId: manager.id });
    expect((await notifyClientFileAttention(now)).notified).toBe(1);

    await addClientFact(hadas, { clientId: client.id, kind: "TEMPORARY", body: "עד מחר", validUntil: new Date("2026-10-15T00:00:00Z"), sources: S1 });
    // The day before it expires, still the same week: quiet.
    expect((await notifyClientFileAttention(new Date("2026-10-14T20:00:00Z"))).notified).toBe(0);
    // The morning after it expired: news.
    expect((await notifyClientFileAttention(new Date("2026-10-15T05:00:00Z"))).notified).toBe(1);
  });

  it("a paused client says nothing", async () => {
    const { client, hadas } = await setup();
    const now = new Date("2026-10-14T05:00:00Z");
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "שאלה", assigneeId: hadas.id });
    await prisma.client.update({ where: { id: client.id }, data: { status: "PAUSED" } });
    expect((await notifyClientFileAttention(now)).notified).toBe(0);
  });

  it("a client with nobody to tell is counted", async () => {
    const { client, hadas } = await setup(false);
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "שאלה בלי אחראי" });
    expect(await notifyClientFileAttention(new Date("2026-10-14T05:00:00Z"))).toEqual({ notified: 0, unowned: 1 });
  });
});
