import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import {
  addClientFact,
  answerClientQuestion,
  closeTemporaryFact,
  confirmClientFact,
  listClientFacts,
  factToTask,
  questionToTask,
  supersedeClientFact,
} from "@/lib/app-domain/client-facts";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 3.4).
//
// What is worth holding here: a fact's words are never overwritten, a
// question is "missing" until answered and its answer needs a source, a
// preference belongs to someone in this client's file only, and Ankora's
// own documents never confirm anything.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" }); // S1
  await addClientSource(user, { clientId: client.id, kind: "ANKORA_DOCUMENT", title: "KI" }); // S2, secondary
  return { client, user };
}

const S1 = [{ code: "S1" }];

describe("client facts", () => {
  it("a changed fact is superseded, never overwritten", async () => {
    const { client, user } = await setup();
    const first = await addClientFact(user, {
      clientId: client.id,
      kind: "ONE_OFF_DECISION",
      body: "Ariel עובד מתוך משתמש משותף",
      decidedAt: new Date("2026-10-04T00:00:00Z"),
      sources: S1,
    });
    const second = await supersedeClientFact(user, first.id, {
      kind: "ONE_OFF_DECISION",
      body: "משתמש נפרד ariel@nux.ai",
      decidedAt: new Date("2026-10-09T00:00:00Z"),
      decidedBy: "אורן",
      sources: [{ code: "S1", at: "12:40" }],
    });

    const old = await prisma.clientFact.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.body).toBe("Ariel עובד מתוך משתמש משותף");
    expect(old.knowledgeStatus).toBe("SUPERSEDED");
    expect(old.supersededById).toBe(second.id);

    const { current, superseded } = await listClientFacts(user, client.id);
    expect(current.map((f) => f.id)).toEqual([second.id]);
    expect(superseded.map((f) => f.id)).toEqual([first.id]);

    // The old version cannot be replaced again, and a kind cannot change.
    await expect(supersedeClientFact(user, first.id, { kind: "ONE_OFF_DECISION", body: "x", decidedAt: new Date(), sources: S1 })).rejects.toThrow("כבר הוחלף");
    await expect(supersedeClientFact(user, second.id, { kind: "NOTE", body: "x", sources: S1 })).rejects.toThrow("אותו סוג");
  });

  it("a temporary fact needs an end, and is closed rather than deleted", async () => {
    const { client, user } = await setup();
    await expect(addClientFact(user, { clientId: client.id, kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי", sources: S1 })).rejects.toThrow("תוקף");
    const fact = await addClientFact(user, {
      clientId: client.id,
      kind: "TEMPORARY",
      body: "Anthropic בכרטיס הפרטי של המנכ״ל",
      validUntilEvent: "עד הצירוף לארגון",
      sources: S1,
    });
    const closed = await closeTemporaryFact(user, fact.id);
    expect(closed.closedAt).not.toBeNull();
    expect((await listClientFacts(user, client.id)).current).toHaveLength(1);
  });

  it("a question is missing until answered, and the answer needs a source", async () => {
    const { client, user } = await setup();
    const q = await addClientFact(user, { clientId: client.id, kind: "QUESTION", body: "מי מורשה החתימה בבנק לאומי?", assigneeId: user.id });
    expect(q.knowledgeStatus).toBe("MISSING");
    expect(q.toResolve).toBeTruthy();

    await expect(answerClientQuestion(user, q.id, { answer: "אורן וגיא", sources: [] })).rejects.toThrow("צריך מקור");
    const answered = await answerClientQuestion(user, q.id, { answer: "אורן וגיא, ביחד", sources: [{ code: "S1", at: "33:05" }] });
    expect(answered.knowledgeStatus).toBe("CONFIRMED");
    expect(answered.answer).toBe("אורן וגיא, ביחד");
    expect(answered.toResolve).toBeNull();
    await expect(answerClientQuestion(user, q.id, { answer: "שוב", sources: S1 })).rejects.toThrow("כבר נענתה");
  });

  it("a question becomes one task, assigned to whoever chases it", async () => {
    const { client, user } = await setup();
    const q = await addClientFact(user, { clientId: client.id, kind: "QUESTION", body: "האם יש הסכם עם Dell?", assigneeId: user.id });
    const { task } = await questionToTask(user, q.id);
    expect(task.clientId).toBe(client.id);
    expect(task.title).toContain("האם יש הסכם עם Dell?");
    expect(task.assignedToId).toBe(user.id);
    await expect(questionToTask(user, q.id)).rejects.toThrow("כבר יש משימה");
  });

  it("temporary information keeps who owns it, becomes one task, and not once closed", async () => {
    const { client, user } = await setup();
    const t = await addClientFact(user, { clientId: client.id, kind: "TEMPORARY", body: "פער של 6,000$ מול רשות המס", validUntilEvent: "עד ההחזר", assigneeId: user.id, sources: S1 });
    expect(t.assigneeId).toBe(user.id);
    // An assignee means something only where someone chases the item.
    const note = await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "הערה", assigneeId: user.id, sources: S1 });
    expect(note.assigneeId).toBeNull();

    const { task } = await factToTask(user, t.id);
    expect(task.title).toBe("מידע זמני: פער של 6,000$ מול רשות המס");
    expect(task.description).toContain("עד ההחזר");
    expect(task.assignedToId).toBe(user.id);
    await expect(factToTask(user, t.id)).rejects.toThrow("כבר יש משימה");

    const other = await addClientFact(user, { clientId: client.id, kind: "TEMPORARY", body: "עוד דבר", validUntilEvent: "עד הצירוף", sources: S1 });
    await closeTemporaryFact(user, other.id);
    await expect(factToTask(user, other.id)).rejects.toThrow("כבר נסגר");
    await expect(factToTask(user, note.id)).rejects.toThrow("רק שאלה פתוחה או מידע זמני");
  });

  it("Ankora's own document never confirms a fact (R14)", async () => {
    const { client, user } = await setup();
    const fact = await addClientFact(user, { clientId: client.id, kind: "FINANCE", body: "מגבלת Justworks: 25,000$ להעברה", sources: [{ code: "S2" }] });
    expect(fact.knowledgeStatus).toBe("UNCERTAIN");
    const still = await confirmClientFact(user, fact.id, [{ code: "S2" }]);
    expect(still.knowledgeStatus).toBe("UNCERTAIN");
    const confirmed = await confirmClientFact(user, fact.id, [{ code: "S2" }, { code: "S1", at: "05:02" }]);
    expect(confirmed.knowledgeStatus).toBe("CONFIRMED");
    expect(confirmed.toResolve).toBeNull();
  });

  it("a preference belongs to someone in this client's file only", async () => {
    const { client, user } = await setup();
    const other = await createTestClient({ name: "Other" });
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId: other.id } });
    await addClientSource(user, { clientId: other.id, kind: "PERSON", title: "x" });
    const theirs = await addClientContact(user, { clientId: other.id, name: "זר", sources: S1 });
    const mine = await addClientContact(user, { clientId: client.id, name: "אורן", sources: S1 });

    await expect(
      addClientFact(user, { clientId: client.id, kind: "PREFERENCE", topic: "COMMUNICATION", body: "WhatsApp", subjectContactId: theirs.id, sources: S1 })
    ).rejects.toThrow("לא נמצא בתיק");
    const pref = await addClientFact(user, {
      clientId: client.id,
      kind: "PREFERENCE",
      topic: "COMMUNICATION",
      body: "WhatsApp, אחר כך Slack, אחר כך מייל",
      subjectContactId: mine.id,
      sources: S1,
    });
    expect(pref.subjectContactId).toBe(mine.id);
  });

  it("is closed to anyone not assigned to the client, and hides restricted facts", async () => {
    const { client, user } = await setup();
    const { user: colleague } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: colleague.id, clientId: client.id } });
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await addClientFact(user, {
      clientId: client.id,
      kind: "NOTE",
      body: "המנכ״ל שוקל למכור",
      audience: "RESTRICTED",
      audienceUserIds: [user.id],
      sources: S1,
    });
    expect((await listClientFacts(user, client.id)).current).toHaveLength(1);
    expect((await listClientFacts(colleague, client.id)).current).toHaveLength(0);
    await expect(listClientFacts(stranger, client.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
