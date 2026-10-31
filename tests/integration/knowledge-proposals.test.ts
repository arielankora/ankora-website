import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientFact, listClientFacts } from "@/lib/app-domain/client-facts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientOrganization } from "@/lib/app-domain/client-contacts";
import { saveNarrative } from "@/lib/app-domain/client-narratives";
import {
  approveProposal,
  attachProposalToExisting,
  countPendingProposals,
  decideProposals,
  listOpenBatches,
  proposalToTask,
  proposeKnowledge,
  rejectProposal,
} from "@/lib/app-domain/knowledge-proposals";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 4, 5.1, 5.2).
//
// What is worth holding here: nothing enters the file without a person,
// the same meeting is one source however often it is sent, a secret is
// never stored and leaves a task behind, a topics-only source gives no
// quotes, and a contradiction never overwrites.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  return { client, user };
}

const MEETING = { kind: "TRANSCRIPT" as const, title: "Nextage & Ankora", occurredAt: new Date("2026-10-12T00:00:00Z"), externalIds: ["ff-123"] };

describe("knowledge proposals", () => {
  it("nothing enters the file until a person approves it, and the meeting is one source", async () => {
    const { client, user } = await setup();
    const first = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", topic: "COMMUNICATION", body: "WhatsApp, אחר כך Slack, אחר כך מייל" }, at: "05:02", reason: "אורן אמר במפורש" },
        { target: "CONTACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", name: "שני הלוי", role: "VP Finance", emails: ["shani@nextage.co.il"], relationship: "PROVIDER" }, at: "12:40" },
      ],
    });
    expect(first).toMatchObject({ sourceCode: "S1", proposed: 2, dropped: [], secretTaskId: null });
    expect((await listClientFacts(user, client.id)).current).toHaveLength(0);
    expect(await countPendingProposals(user, client.id)).toBe(2);

    // The same recording again: the same source, not S2.
    const again = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "עוד משהו" } }] });
    expect(again.sourceCode).toBe("S1");
    expect(await prisma.clientSource.count({ where: { clientId: client.id } })).toBe(1);

    const [batch] = (await listOpenBatches(user, { clientId: client.id })).filter((b) => b.id === first.batchId);
    const [pref, contact] = batch.proposals;
    await approveProposal(user, pref.id);
    const facts = (await listClientFacts(user, client.id)).current;
    expect(facts).toHaveLength(1);
    expect(facts[0].sources).toEqual([{ code: "S1", at: "05:02" }]);

    await approveProposal(user, contact.id, { role: "סמנכ״לית כספים" });
    const approved = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: contact.id } });
    expect(approved.edited).toBe(true);
    expect((await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id } })).role).toBe("סמנכ״לית כספים");
    // Every proposal decided: the batch closes.
    expect((await prisma.knowledgeBatch.findUniqueOrThrow({ where: { id: first.batchId! } })).closedAt).not.toBeNull();
    await expect(approveProposal(user, pref.id)).rejects.toThrow("כבר הוחלט");
  });

  it("a secret is never stored, and leaves a task to change it", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "SYSTEM", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", systemName: "Mercury", notes: "הסיסמה היא Nux2026!" } },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "FINANCE", body: "מגבלת Justworks: 25,000$ להעברה" } },
      ],
    });
    expect(r.proposed).toBe(1);
    expect(r.dropped).toEqual([{ index: 0, reason: "נמצא סיסמה. הפריט לא נשמר." }]);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: r.secretTaskId! } });
    expect(task.title).toContain("להחליף סוד");
    expect(task.description).not.toContain("Nux2026");
    const stored = JSON.stringify(await prisma.knowledgeBatch.findMany()) + JSON.stringify(await prisma.knowledgeProposal.findMany());
    expect(stored).not.toContain("Nux2026");
    // An edit that adds a secret is refused too.
    const [p] = (await listOpenBatches(user))[0].proposals;
    await expect(approveProposal(user, p.id, { body: "password: hunter22 בבנק" })).rejects.toThrow("בכספת");
  });

  it("a topics-only source gives no quotes, and an Ankora document confirms nothing", async () => {
    const { client, user } = await setup();
    const board = await proposeKnowledge(user, {
      clientId: client.id,
      source: { kind: "TRANSCRIPT", title: "ישיבת הנהלה", restriction: "TOPICS_ONLY" },
      items: [
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "נדון גיוס" }, quote: "אנחנו מגייסים 5 מיליון" },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "נדון תקציב 2027" } },
      ],
    });
    expect(board.proposed).toBe(1);
    expect(board.dropped[0].reason).toContain("נושאים בלבד");

    const ki = await proposeKnowledge(user, {
      clientId: client.id,
      source: { kind: "ANKORA_DOCUMENT", title: "KI" },
      items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "FINANCE", body: "שכר ב-9 לחודש" } }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === ki.batchId)!.proposals[0];
    expect(p.flags).toEqual([expect.objectContaining({ code: "R14" })]);
    const fact = await prisma.clientFact.findUniqueOrThrow({ where: { id: (await approveProposal(user, p.id)).resultId! } });
    expect(fact.knowledgeStatus).toBe("UNCERTAIN");
  });

  it("a contradiction joins the alternatives and never overwrites", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "CLIENT_DOCUMENT", title: "טופס בנק" }); // S1
    const bank = await addClientFact(user, { clientId: client.id, kind: "FINANCE", body: "הבנק בישראל: לאומי", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING, // S2
      items: [{ target: "FACT", reason: "נאמר בפגישה", action: "CONTRADICT", targetId: bank.id, payload: { knowledgeStatus: "CONFIRMED", kind: "FINANCE", body: "הבנק בישראל: הפועלים" }, at: "21:30" }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    expect(p.existing?.body).toBe("הבנק בישראל: לאומי");
    await approveProposal(user, p.id);
    const after = await prisma.clientFact.findUniqueOrThrow({ where: { id: bank.id } });
    expect(after.body).toBe("הבנק בישראל: לאומי");
    expect(after.knowledgeStatus).toBe("UNCERTAIN");
    expect(after.alternatives).toEqual([expect.objectContaining({ value: "הבנק בישראל: הפועלים", sources: [{ code: "S2", at: "21:30" }] })]);
  });

  it("a new version of another kind answers an open question, or enters as a new item", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" }); // S1
    const question = await addClientFact(user, { clientId: client.id, kind: "QUESTION", body: "ימי חופש לעובדים בארה\"ב: מה המדיניות?", sources: [{ code: "S1" }] });
    const pref = await addClientFact(user, { clientId: client.id, kind: "PREFERENCE", body: "WhatsApp קודם", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING, // S2
      items: [
        { target: "FACT", reason: "נאמר בפגישה", action: "SUPERSEDE", targetId: question.id, payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "Unlimited Vacation, עם דיווח מראש" }, at: "91:32" },
        { target: "FACT", reason: "נאמר בפגישה", action: "SUPERSEDE", targetId: pref.id, payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "Slack לעניינים דחופים" }, at: "10:00" },
      ],
    });
    const [answer, note] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    expect(answer.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: "KIND", message: expect.stringContaining("תשובה") })]));
    expect(note.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: "KIND", message: expect.stringContaining("פריט חדש") })]));

    expect((await approveProposal(user, answer.id)).resultId).toBe(question.id);
    const answered = await prisma.clientFact.findUniqueOrThrow({ where: { id: question.id } });
    expect(answered).toMatchObject({ kind: "QUESTION", answer: "Unlimited Vacation, עם דיווח מראש", knowledgeStatus: "CONFIRMED" });
    expect(answered.answeredAt).not.toBeNull();

    const added = await prisma.clientFact.findUniqueOrThrow({ where: { id: (await approveProposal(user, note.id)).resultId! } });
    expect(added).toMatchObject({ kind: "NOTE", body: "Slack לעניינים דחופים" });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: pref.id } })).knowledgeStatus).not.toBe("SUPERSEDED");
  });

  it("flags what is already in the file, and a rejection needs a reason", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" });
    await addClientFact(user, { clientId: client.id, kind: "REQUIREMENT", body: "כל תהליך מתועד עם Owner ו-SLA", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: { code: "s1" },
      items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "REQUIREMENT", body: "כל תהליך מתועד עם owner ו SLA." } }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    expect(p.flags).toEqual([expect.objectContaining({ code: "DUPLICATE" })]);
    await expect(rejectProposal(user, p.id, " ")).rejects.toThrow("למה");
    const rejected = await rejectProposal(user, p.id, "כבר בתיק");
    expect(rejected.state).toBe("REJECTED");
  });

  // 20.10.2026: IBI entered NUX's file from another meeting after S3 had
  // proposed it. The card still offered "אישור", and approving it was
  // refused with nothing to do next.
  it("what entered the file after it was proposed is found when the card is read, and closes onto the item there", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "ORGANIZATION", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", name: "IBI", role: "ניהול תוכנית האופציות" }, at: "34:37" },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "9 עובדים בישראל" }, at: "05:00" },
        { target: "DOMAIN", reason: "נאמר בפגישה", payload: { domain: "nux.ai", kind: "CLIENT" } },
      ],
    });
    const before = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    expect(before.map((p) => p.alreadyIn)).toEqual([null, null, null]);
    expect(before.flatMap((p) => (p.flags as { code: string }[]).map((f) => f.code))).not.toContain("DUPLICATE");

    // Meanwhile all three entered the file by another way.
    const ibi = await addClientOrganization(user, { clientId: client.id, name: "ibi", role: "תוכנית אופציות", sources: [{ code: "S1" }] });
    const fact = await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "9 עובדים בישראל.", sources: [{ code: "S1" }] });
    await prisma.clientDomain.create({ data: { clientId: client.id, domain: "nux.ai", kind: "CLIENT" } });

    const [org, note, domain] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    expect(org.alreadyIn).toMatchObject({ id: ibi.id, addsSources: true });
    expect(org.alreadyIn!.body).toContain("ibi");
    expect((org.flags as { code: string }[]).map((f) => f.code)).toContain("DUPLICATE");
    expect(note.alreadyIn).toMatchObject({ id: fact.id, addsSources: true });
    expect(domain.alreadyIn).toMatchObject({ addsSources: false });

    // Approving makes no second copy, and several at once wait for one at a time.
    await expect(approveProposal(user, org.id)).rejects.toThrow("כבר בתיק");
    expect((await decideProposals(user, [org.id], { approve: true })).failed).toEqual([{ id: org.id, error: expect.stringContaining("אחת אחת") }]);

    const closed = await attachProposalToExisting(user, org.id);
    expect(closed).toMatchObject({ state: "APPROVED", attached: true, edited: false, resultId: ibi.id });
    expect((await prisma.clientOrganization.findUniqueOrThrow({ where: { id: ibi.id } })).sources).toEqual([{ code: "S1" }, { code: "S2", at: "34:37" }]);
    expect(await prisma.clientOrganization.count({ where: { clientId: client.id, deletedAt: null } })).toBe(1);
    expect(await prisma.auditEvent.findFirst({ where: { entityId: org.id, action: "knowledge_proposal.attach" } })).not.toBeNull();

    await attachProposalToExisting(user, note.id);
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: fact.id } })).sources).toEqual([{ code: "S1" }, { code: "S2", at: "05:00" }]);

    // A domain keeps no sources: it only closes.
    expect(await attachProposalToExisting(user, domain.id)).toMatchObject({ state: "APPROVED", attached: true });
    expect(await countPendingProposals(user, client.id)).toBe(0);
    await expect(attachProposalToExisting(user, org.id)).rejects.toThrow("כבר הוחלט");
  });

  it("closing onto the file needs the item to still be there", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "ORGANIZATION", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", name: "Justworks" } }],
    });
    const [p] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    await expect(attachProposalToExisting(user, p.id)).rejects.toThrow("כבר לא בתיק");
    expect((await approveProposal(user, p.id)).state).toBe("APPROVED");
  });

  it("decides several at once, each as on its own; what changes the file or may be there already waits for one at a time", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" });
    await addClientFact(user, { clientId: client.id, kind: "REQUIREMENT", body: "דוח שבועי לאורן", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "9 עובדים שכירים בישראל" } },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "SOC 2 הושג" } },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "REQUIREMENT", body: "דוח שבועי לאורן" } },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "שיחת חולין" } },
      ],
    });
    const [a, b, dup, chat] = (await listOpenBatches(user)).find((x) => x.id === r.batchId)!.proposals;

    const approved = await decideProposals(user, [a.id, b.id, dup.id], { approve: true });
    expect(approved.done.sort()).toEqual([a.id, b.id].sort());
    expect(approved.failed).toEqual([{ id: dup.id, error: expect.stringContaining("אחת אחת") }]);
    expect((await listClientFacts(user, client.id)).current.map((f) => f.body).sort()).toEqual(["9 עובדים שכירים בישראל", "SOC 2 הושג", "דוח שבועי לאורן"].sort());
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: a.id, action: "knowledge_proposal.approve" } });
    expect(audit!.afterJson).toMatchObject({ bulk: true });

    await expect(decideProposals(user, [dup.id, chat.id], { approve: false, reason: " " })).rejects.toThrow("למה");
    const rejected = await decideProposals(user, [dup.id, chat.id, a.id], { approve: false, reason: "כבר בתיק, או לא לעבודה" });
    expect(rejected.done.sort()).toEqual([dup.id, chat.id].sort());
    expect(rejected.failed).toEqual([{ id: a.id, error: expect.stringContaining("כבר הוחלט") }]);
    expect(await countPendingProposals(user, client.id)).toBe(0);

    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const other = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "עוד" } }] });
    const [mine] = (await listOpenBatches(user)).find((x) => x.id === other.batchId)!.proposals;
    expect((await decideProposals(stranger, [mine.id], { approve: true })).failed).toHaveLength(1);
  });

  it("is closed to anyone not assigned to the client, in both directions", async () => {
    const { client, user } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(proposeKnowledge(stranger, { clientId: client.id, source: MEETING, items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "x" } }] })).rejects.toBeInstanceOf(ForbiddenError);
    const r = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "x" } }] });
    expect(await listOpenBatches(stranger)).toEqual([]);
    const pid = (await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: r.batchId! } })).id;
    await expect(approveProposal(stranger, pid)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("request types and the extraction brief", () => {
  it("a proposed request type enters the file when approved", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "REQUEST_TYPE", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", title: "חשבונית Inc", arrivesVia: "billing-us", handling: "לשני ולג'נן, לא לאיילה" }, at: "14:20" }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    const approved = await approveProposal(user, p.id);
    const rt = await prisma.requestType.findUniqueOrThrow({ where: { id: approved.resultId! } });
    expect(rt.handling).toBe("לשני ולג'נן, לא לאיילה");
    expect(rt.sources).toEqual([{ code: "S1", at: "14:20" }]);
  });

  it("an entity, a process, a domain and a free text are proposed too, and enter the file only as far as approval allows", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "ENTITY", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", name: "NUX Inc", country: "US", currency: "USD" }, at: "02:00" },
        { target: "ENTITY", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", name: "NUX.AI Ltd", country: "IL", parentName: "NUX Inc" }, at: "02:10" },
        {
          target: "PROCESS", reason: "נאמר בפגישה",
          payload: { knowledgeStatus: "CONFIRMED", title: "תשלומי ספקים LTD", triggerKinds: ["SCHEDULED"], triggerText: "ב-10 וב-25", steps: [{ title: "מעלים ל-Doka", actionTags: ["INVOICE"] }, { title: "מורשה חתימה חותם", actionTags: ["BANK_SIGNATURE"], requiresApproval: true }] },
          at: "24:11",
        },
        { target: "DOMAIN", reason: "נאמר בפגישה", payload: { domain: "nux.ai", kind: "CLIENT" } },
        { target: "NARRATIVE", reason: "נאמר בפגישה", payload: { kind: "OVERVIEW", body: "חברה, סטארטאפ AI עם שתי ישויות [S1 02:00]" } },
      ],
    });
    expect(r.proposed).toBe(5);
    const batch = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!;
    const of = (t: string) => batch.proposals.filter((p) => p.target === t);
    expect((of("PROCESS")[0].flags as { code: string }[]).map((f) => f.code)).toContain("PROCESS");

    // The parent first; the child finds it by name.
    const inc = await approveProposal(user, of("ENTITY")[0].id);
    const ltd = await approveProposal(user, of("ENTITY")[1].id);
    expect((await prisma.clientEntity.findUniqueOrThrow({ where: { id: ltd.resultId! } })).parentId).toBe(inc.resultId);

    // A process enters as a draft, its procedure a draft version: nothing runs.
    const proc = await approveProposal(user, of("PROCESS")[0].id);
    const process = await prisma.process.findUniqueOrThrow({ where: { id: proc.resultId! }, include: { versions: true } });
    expect(process.status).toBe("DRAFT");
    expect(process.versions.map((v) => [v.version, v.status])).toEqual([[1, "DRAFT"]]);

    const dom = await approveProposal(user, of("DOMAIN")[0].id);
    expect((await prisma.clientDomain.findUniqueOrThrow({ where: { id: dom.resultId! } })).domain).toBe("nux.ai");

    // Someone changed the text since it was proposed: the proposal does not overwrite it.
    await saveNarrative(user, { clientId: client.id, kind: "OVERVIEW", body: "טקסט שהדס כתבה בינתיים", baseVersion: 0 });
    await expect(approveProposal(user, of("NARRATIVE")[0].id)).rejects.toThrow("מישהו שינה את הטקסט");
  });

  it("a free text proposed against the current version replaces it when approved", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
    await saveNarrative(user, { clientId: client.id, kind: "OUR_ROLE", body: "גרסה ראשונה", baseVersion: 0 });
    const r = await proposeKnowledge(user, { clientId: client.id, source: { code: "S1" }, items: [{ target: "NARRATIVE", reason: "נאמר בפגישה", payload: { kind: "OUR_ROLE", body: "אנחנו מנהלים את התפעול השוטף" } }] });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    await approveProposal(user, p.id);
    const versions = await prisma.clientNarrative.findMany({ where: { clientId: client.id, kind: "OUR_ROLE" }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.body)).toEqual(["גרסה ראשונה", "אנחנו מנהלים את התפעול השוטף"]);
  });

  it("what breaks a rule is said on the card and blocks approval until the edit fixes it", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "TEMPORARY", body: "Anthropic משולם מהכרטיס הפרטי של אורן" } },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "לפי הסיכום [S7] הם עוברים לבנק אחר" } },
      ],
    });
    const [temporary, cited] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    expect((temporary.flags as { block?: boolean }[]).some((f) => f.block)).toBe(true);
    await expect(approveProposal(user, temporary.id)).rejects.toThrow("מידע זמני צריך תוקף");
    const fixed = await approveProposal(user, temporary.id, { validUntilEvent: "עד הצירוף לארגון" });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: fixed.resultId! } })).validUntilEvent).toBe("עד הצירוף לארגון");

    await expect(approveProposal(user, cited.id)).rejects.toThrow("S7");
    // Approving several together leaves it out, with the reason.
    const bulk = await decideProposals(user, [cited.id], { approve: true });
    expect(bulk.done).toEqual([]);
    expect(bulk.failed[0].error).toContain("חוסם");
  });

  it("lists the user's clients with their domains, and the recordings already proposed", async () => {
    const { extractionBrief } = await import("@/lib/app-domain/extraction-brief");
    const { addClientDomain } = await import("@/lib/app-domain/client-sources");
    const { client, user } = await setup();
    const other = await createTestClient({ name: "Not mine" });
    await addClientDomain(user, { clientId: client.id, domain: "nux.ai", kind: "CLIENT" });
    await addClientDomain(user, { clientId: client.id, domain: "nextage.co.il", kind: "PARTNER", organizationName: "Nextage" });
    await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "x" } }] });

    const b = await extractionBrief(user);
    expect(b.guide.version).toBeNull();
    expect(b.guide.rules.length).toBeGreaterThan(3);
    expect(b.clients).toEqual([
      {
        name: "NUX",
        domains: expect.arrayContaining([
          { domain: "nux.ai", kind: "CLIENT", organization: null },
          { domain: "nextage.co.il", kind: "PARTNER", organization: "Nextage" },
        ]),
        dataHandlingRules: [],
      },
    ]);
    expect(b.clients.map((c) => c.name)).not.toContain(other.name);
    expect(b.processedRecordings).toEqual([{ firefliesId: "ff-123", client: "NUX", sourceCode: "S1", title: "Nextage & Ankora" }]);
  });

  it("spec 5.2: an item without a reason is refused on arrival, and confidence is kept", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "SYSTEM", payload: { systemName: "Mercury", knowledgeStatus: "CONFIRMED" } },
        { target: "SYSTEM", reason: "נאמר ב-08:13", payload: { systemName: "Brex" } },
        { target: "SYSTEM", reason: "נאמר ב-08:13", confidence: "LOW", payload: { systemName: "Ramp", knowledgeStatus: "CONFIRMED" }, at: "08:13" },
        { target: "SYSTEM", reason: "נאמר ב-09:00", confidence: "SURE", payload: { systemName: "Doka", knowledgeStatus: "CONFIRMED" } },
      ],
    });
    // 31.10.2026: no status is no longer a refusal; it comes from confidence.
    expect(r.proposed).toBe(3);
    expect(r.dropped).toEqual([{ index: 0, reason: expect.stringContaining("items[0].reason") }]);
    const rows = await prisma.knowledgeProposal.findMany({ where: { batchId: r.batchId! }, orderBy: { createdAt: "asc" } });
    // A level that is not one of the three is no level.
    expect(rows.map((p) => p.confidence)).toEqual([null, "LOW", null]);
  });
});

// 31.10.2026, RIMED: every item came back "חסר סטטוס", because the tool's
// schema had no status field and a `status` sent was stripped or not read.
// And a new source was registered even when every item was dropped (S15,
// S16, empty).
describe("the status of a proposal", () => {
  const statusOf = async (batchId: string) =>
    (await prisma.knowledgeProposal.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } })).map((p) => (p.payload as { knowledgeStatus?: string }).knowledgeStatus);

  it("without a status, comes from confidence: HIGH is confirmed, anything else uncertain", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", reason: "נאמר", confidence: "HIGH", payload: { kind: "PREFERENCE", body: "וואטסאפ קודם" } },
        { target: "FACT", reason: "נאמר", confidence: "MEDIUM", payload: { kind: "NOTE", body: "אולי Slack" } },
        { target: "FACT", reason: "נאמר", confidence: "LOW", payload: { kind: "NOTE", body: "אולי מייל" } },
        { target: "FACT", reason: "נאמר", payload: { kind: "NOTE", body: "בלי ביטחון" } },
      ],
    });
    expect(r).toMatchObject({ proposed: 4, dropped: [] });
    expect(await statusOf(r.batchId!)).toEqual(["CONFIRMED", "UNCERTAIN", "UNCERTAIN", "UNCERTAIN"]);
  });

  it("a valid status is kept as sent, on the item or in the payload", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", reason: "נאמר", confidence: "HIGH", status: "MISSING", payload: { kind: "NOTE", body: "חסר מספר עוסק", toResolve: "לבקש מאורן" } },
        { target: "FACT", reason: "נאמר", confidence: "LOW", status: "CONFIRMED", payload: { kind: "NOTE", body: "אמר במפורש" } },
        { target: "FACT", reason: "נאמר", confidence: "HIGH", payload: { kind: "NOTE", body: "לא ודאי", status: "UNCERTAIN", toResolve: "לשאול" } },
        { target: "FACT", reason: "נאמר", payload: { kind: "NOTE", body: "השם הישן", knowledgeStatus: "CONFIRMED" } },
      ],
    });
    expect(r).toMatchObject({ proposed: 4, dropped: [] });
    expect(await statusOf(r.batchId!)).toEqual(["MISSING", "CONFIRMED", "UNCERTAIN", "CONFIRMED"]);
    const payloads = (await prisma.knowledgeProposal.findMany({ where: { batchId: r.batchId! } })).map((p) => p.payload as Record<string, unknown>);
    expect(payloads.every((p) => !("status" in p))).toBe(true);
  });

  it("a status that is not one of the three is refused, and the reply says where", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: { code: (await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "x" })).code },
      items: [
        { target: "FACT", reason: "נאמר", status: "SURE", payload: { kind: "NOTE", body: "א" } },
        { target: "FACT", reason: "נאמר", payload: { kind: "NOTE", body: "ב", knowledgeStatus: "MAYBE" } },
        { target: "FACT", reason: "נאמר", status: "CONFIRMED", payload: { kind: "NOTE", body: "ג", knowledgeStatus: "UNCERTAIN", toResolve: "?" } },
        { target: "FACT", reason: "נאמר", status: "CONFIRMED", payload: { kind: "NOTE", body: "ד" } },
      ],
    });
    expect(r.proposed).toBe(1);
    expect(r.dropped).toEqual([
      { index: 0, reason: expect.stringContaining("items[0].status") },
      { index: 1, reason: expect.stringContaining("items[1].payload.knowledgeStatus") },
      { index: 2, reason: expect.stringContaining("סותרים") },
    ]);
  });

  it("a status on a task, a date or a question is not asked for, and not added", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", reason: "נשאל", confidence: "HIGH", payload: { kind: "QUESTION", body: "מי מורשה החתימה?" } },
        { target: "TASK", reason: "הובטח", confidence: "HIGH", status: "CONFIRMED", payload: { title: "לשלוח לדנה את החוזה" } },
      ],
    });
    expect(r).toMatchObject({ proposed: 2, dropped: [] });
    expect(await statusOf(r.batchId!)).toEqual([undefined, undefined]);
  });

  it("when every item is dropped, a new source is not registered", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: { kind: "PERSON", title: "שיחה עם אורן" },
      items: [
        { target: "FACT", payload: { kind: "NOTE", body: "בלי סיבה" } },
        { target: "FACT", reason: "נאמר", status: "SURE", payload: { kind: "NOTE", body: "סטטוס שגוי" } },
      ],
    });
    expect(r).toMatchObject({ batchId: null, sourceCode: null, proposed: 0 });
    expect(await prisma.clientSource.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.knowledgeBatch.count({ where: { clientId: client.id } })).toBe(0);

    // Sent again with one good item: registered once, as S1, and cited.
    const ok = await proposeKnowledge(user, {
      clientId: client.id,
      source: { kind: "PERSON", title: "שיחה עם אורן" },
      items: [{ target: "FACT", reason: "נאמר", confidence: "HIGH", payload: { kind: "PREFERENCE", body: "מייל ולא טלפון" } }],
    });
    expect(ok).toMatchObject({ sourceCode: "S1", proposed: 1 });
    expect(await prisma.clientSource.count({ where: { clientId: client.id } })).toBe(1);
    const [p] = await prisma.knowledgeProposal.findMany({ where: { batchId: ok.batchId! } });
    expect((p.payload as { sources: unknown }).sources).toEqual([{ code: "S1" }]);
  });

  it("an existing source with every item dropped is left as it was", async () => {
    const { client, user } = await setup();
    const s = await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "x" });
    const r = await proposeKnowledge(user, { clientId: client.id, source: { code: s.code }, items: [{ target: "FACT", payload: { kind: "NOTE", body: "בלי סיבה" } }] });
    expect(r).toMatchObject({ batchId: null, sourceCode: s.code, proposed: 0 });
    expect(await prisma.clientSource.count({ where: { clientId: client.id, deletedAt: null } })).toBe(1);
  });
});

describe("a proposal that is a task", () => {
  it("opens a task on the client instead of entering the file, and closes the batch", async () => {
    const { client, user } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [{ target: "FACT", reason: "אורן ביקש בסוף הפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "לשלוח לדנה את החוזה המעודכן" }, at: "01:00" }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    await expect(proposalToTask(user, p.id, { description: "הסיסמה היא password=Hunter2Hunter2!" })).rejects.toThrow("סיסמה");

    const { taskId } = await proposalToTask(user, p.id, { dueDate: new Date("2026-10-22T00:00:00Z") });
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ clientId: client.id, title: "לשלוח לדנה את החוזה המעודכן", assignedToId: user.id });
    expect(task.description).toContain("למה: אורן ביקש בסוף הפגישה");
    expect(task.description).toContain("https://app.fireflies.ai/view/ff-123?t=60");
    expect(task.dueDate?.toISOString()).toBe("2026-10-22T00:00:00.000Z");

    const after = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ state: "TASK", resultId: taskId, decidedById: user.id });
    expect((await listClientFacts(user, client.id)).current).toHaveLength(0);
    expect((await prisma.knowledgeBatch.findUniqueOrThrow({ where: { id: r.batchId! } })).closedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "knowledge_proposal.to_task", entityId: p.id } })).toBe(1);
    // Decided once: not again, not as a task and not into the file.
    await expect(proposalToTask(user, p.id)).rejects.toThrow("כבר הוחלט");
  });
});

describe("a task Claude proposes", () => {
  it("opens a task when approved, on the person named, and never enters the file", async () => {
    const { client, user } = await setup();
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.user.update({ where: { id: hadas.id }, data: { name: "הדס בדיקה" } });
    await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "TASK", reason: "אורן ביקש בסוף הפגישה", payload: { title: "לשלוח לדנה את החוזה המעודכן", dueDate: "2026-10-22", assigneeName: "הדס בדיקה", priority: "HIGH" }, at: "01:00" },
        { target: "TASK", reason: "נאמר בפגישה", payload: { title: "לתאם שיחה עם רואה החשבון", assigneeName: "אין כזה" } },
      ],
    });
    expect(r.proposed).toBe(2);
    const [send, call] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    expect(send.flags).toEqual([]);
    expect(call.flags).toEqual([expect.objectContaining({ code: "OWNER" })]);

    const approved = await approveProposal(user, send.id);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: approved.resultId! } });
    expect(task).toMatchObject({ clientId: client.id, title: "לשלוח לדנה את החוזה המעודכן", assignedToId: hadas.id, priority: "HIGH" });
    expect(task.dueDate?.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(task.description).toContain("ברגע בשיחה: https://app.fireflies.ai/view/ff-123?t=60");
    expect((await listClientFacts(user, client.id)).current).toHaveLength(0);

    // A name that is nobody: the task is the approver's.
    const second = await approveProposal(user, call.id, { title: "לתאם שיחה עם רואה החשבון של NUX" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: second.resultId! } })).toMatchObject({ title: "לתאם שיחה עם רואה החשבון של NUX", assignedToId: user.id });
    await expect(proposalToTask(user, call.id)).rejects.toThrow("כבר הוחלט");
  });
});
