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

/// This morning, 05:00 UTC, when the daily job runs. Relative to the real
/// clock on purpose: the job compares against notifications it wrote, and
/// those carry the real time, so a fixed date here turns the test into a
/// time bomb (it broke the day after it was written).
function morning(offsetDays = 0): Date {
  const d = new Date();
  d.setUTCHours(5, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY);
}
const day = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);

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
    await addClientFact(hadas, { clientId: client.id, kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי", validUntil: day(morning(-14)), sources: S1 });
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "מי מורשה החתימה?", assigneeId: hadas.id });
    const stale = await addClientFact(hadas, { clientId: client.id, kind: "FINANCE", body: "מגבלת Justworks", knowledgeStatus: "UNCERTAIN", toResolve: "אישור בכתב", sources: S1 });
    await prisma.clientFact.update({ where: { id: stale.id }, data: { updatedAt: morning(-45) } });

    const now = morning();
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
    const now = morning();
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "שאלה", assigneeId: manager.id });
    expect((await notifyClientFileAttention(now)).notified).toBe(1);

    await addClientFact(hadas, { clientId: client.id, kind: "TEMPORARY", body: "עד מחר", validUntil: day(morning(1)), sources: S1 });
    // The day before it expires, still the same week: quiet.
    expect((await notifyClientFileAttention(new Date(now.getTime() + 15 * 60 * 60 * 1000))).notified).toBe(0);
    // The morning after it expired: news.
    expect((await notifyClientFileAttention(morning(1))).notified).toBe(1);
  });

  it("a paused client says nothing", async () => {
    const { client, hadas } = await setup();
    const now = morning();
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "שאלה", assigneeId: hadas.id });
    await prisma.client.update({ where: { id: client.id }, data: { status: "PAUSED" } });
    expect((await notifyClientFileAttention(now)).notified).toBe(0);
  });

  it("a client with nobody to tell is counted", async () => {
    const { client, hadas } = await setup(false);
    await addClientFact(hadas, { clientId: client.id, kind: "QUESTION", body: "שאלה בלי אחראי" });
    expect(await notifyClientFileAttention(morning())).toEqual({ notified: 0, unowned: 1 });
  });

  it("whoever owns a temporary item hears when it expired, with only their own items", async () => {
    const { client, manager, hadas } = await setup();
    await addClientFact(hadas, { clientId: client.id, kind: "TEMPORARY", body: "פער מול רשות המס", validUntil: day(morning(-3)), assigneeId: hadas.id, sources: S1 });
    await addClientFact(hadas, { clientId: client.id, kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי", validUntil: day(morning(-2)), sources: S1 });
    expect(await notifyClientFileAttention(morning())).toEqual({ notified: 2, unowned: 0 });
    const toHadas = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: ATTENTION_TYPE } });
    expect(toHadas.body).toContain("עבר את התוקף");
    expect(toHadas.body).not.toContain("2");
    const toManager = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: ATTENTION_TYPE } });
    expect(toManager.body).toContain("2");
  });

  it("every kind of item counts, its owner hears about theirs, and a rule waiting for approval tells the manager and its approvers", async () => {
    const { client, manager, hadas } = await setup();
    const old = morning(-45);
    await prisma.requestType.create({ data: { clientId: client.id, title: "חשבונית ספק", handling: "מעבירים לאיילה", knowledgeStatus: "UNCERTAIN", toResolve: "לשאול", ownerId: hadas.id, updatedAt: old } });
    await prisma.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "תשלומי ספקים", knowledgeStatus: "UNCERTAIN", toResolve: "לשאול", updatedAt: old } });
    await prisma.clientPolicy.create({ data: { clientId: client.id, kind: "THRESHOLD", title: "סף", statement: "מעל 5,000 באישור", interimStatement: "הכול באישור", status: "PROPOSED", createdAt: old, updatedAt: old } });

    // The manager who approves this client's rules hears it too (20.10.2026).
    const { user: approver } = await createTestUser({ role: "ANKORA_ADMIN" });
    await prisma.client.update({ where: { id: client.id }, data: { ruleApproverIds: [approver.id] } });

    expect(await notifyClientFileAttention(morning())).toEqual({ notified: 3, unowned: 0 });
    const toManager = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: ATTENTION_TYPE } });
    expect(toManager.body).toBe("2 פריטים לא ודאיים כבר יותר מ-14 יום. כלל מוצע אחד מחכה לאישור מנהל כבר יותר מ-3 ימים, ועד אז הוא לא מחייב.");
    const toApprover = await prisma.notification.findFirstOrThrow({ where: { userId: approver.id, type: ATTENTION_TYPE } });
    expect(toApprover.body).toBe("כלל מוצע אחד מחכה לאישור מנהל כבר יותר מ-3 ימים, ועד אז הוא לא מחייב.");
    // The owner hears only about what they keep.
    const toHadas = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: ATTENTION_TYPE } });
    expect(toHadas.body).toBe("פריט אחד לא ודאי כבר יותר מ-14 יום.");
  });

  it("spec 3.11: a rule past its review date tells the manager and its owner", async () => {
    const { client, manager, hadas } = await setup();
    await prisma.clientPolicy.create({ data: { clientId: client.id, kind: "INFO", title: "דוחות", statement: "רבעוני", status: "ACTIVE", reviewBy: morning(-2), ownerId: hadas.id } });
    expect(await notifyClientFileAttention(morning())).toEqual({ notified: 2, unowned: 0 });
    const toManager = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: ATTENTION_TYPE } });
    expect(toManager.body).toBe("הגיע מועד הסקירה של כלל אחד.");
    const toHadas = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: ATTENTION_TYPE } });
    expect(toHadas.body).toBe("הגיע מועד הסקירה של כלל אחד.");
  });

  it("proposals waiting more than a week tell the manager about all, and the sender about theirs (20.10.2026)", async () => {
    const { client, manager, hadas } = await setup();
    const batch = await prisma.knowledgeBatch.create({ data: { clientId: client.id, createdById: hadas.id } });
    const proposal = (state: "PENDING" | "APPROVED", ageDays: number) =>
      prisma.knowledgeProposal.create({
        data: { batchId: batch.id, clientId: client.id, target: "PROCESS", payload: { title: "קליטה" }, state, createdAt: morning(-ageDays) },
      });
    await proposal("PENDING", 9);
    await proposal("PENDING", 10);
    await proposal("PENDING", 2);
    await proposal("APPROVED", 30);
    const other = await prisma.knowledgeBatch.create({ data: { clientId: client.id, createdById: manager.id } });
    await prisma.knowledgeProposal.create({ data: { batchId: other.id, clientId: client.id, target: "FACT", payload: { body: "x" }, createdAt: morning(-8) } });

    expect(await notifyClientFileAttention(morning())).toEqual({ notified: 2, unowned: 0 });
    const toManager = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: ATTENTION_TYPE } });
    expect(toManager.body).toBe("3 הצעות מחכות במסך הבדיקה כבר יותר מ-7 ימים, ועד שיאושרו הן לא בתיק.");
    const toHadas = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: ATTENTION_TYPE } });
    expect(toHadas.body).toBe("2 הצעות מחכות במסך הבדיקה כבר יותר מ-7 ימים, ועד שיאושרו הן לא בתיק.");
  });

  it("a file with no account manager still reaches whoever sent the waiting proposals", async () => {
    const { client, hadas } = await setup(false);
    const batch = await prisma.knowledgeBatch.create({ data: { clientId: client.id, createdById: hadas.id } });
    await prisma.knowledgeProposal.create({ data: { batchId: batch.id, clientId: client.id, target: "PROCESS", payload: { title: "קליטה" }, createdAt: morning(-8) } });
    expect(await notifyClientFileAttention(morning())).toEqual({ notified: 1, unowned: 0 });
  });
});

