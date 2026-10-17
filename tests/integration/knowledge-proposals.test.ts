import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientFact, listClientFacts } from "@/lib/app-domain/client-facts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import {
  approveProposal,
  countPendingProposals,
  decideProposals,
  listOpenBatches,
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
        { target: "FACT", payload: { kind: "PREFERENCE", topic: "COMMUNICATION", body: "WhatsApp, אחר כך Slack, אחר כך מייל" }, at: "05:02", reason: "אורן אמר במפורש" },
        { target: "CONTACT", payload: { name: "שני הלוי", role: "VP Finance", emails: ["shani@nextage.co.il"], relationship: "PROVIDER" }, at: "12:40" },
      ],
    });
    expect(first).toMatchObject({ sourceCode: "S1", proposed: 2, dropped: [], secretTaskId: null });
    expect((await listClientFacts(user, client.id)).current).toHaveLength(0);
    expect(await countPendingProposals(user, client.id)).toBe(2);

    // The same recording again: the same source, not S2.
    const again = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "עוד משהו" } }] });
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
        { target: "SYSTEM", payload: { systemName: "Mercury", notes: "הסיסמה היא Nux2026!" } },
        { target: "FACT", payload: { kind: "FINANCE", body: "מגבלת Justworks: 25,000$ להעברה" } },
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
        { target: "FACT", payload: { kind: "NOTE", body: "נדון גיוס" }, quote: "אנחנו מגייסים 5 מיליון" },
        { target: "FACT", payload: { kind: "NOTE", body: "נדון תקציב 2027" } },
      ],
    });
    expect(board.proposed).toBe(1);
    expect(board.dropped[0].reason).toContain("נושאים בלבד");

    const ki = await proposeKnowledge(user, {
      clientId: client.id,
      source: { kind: "ANKORA_DOCUMENT", title: "KI" },
      items: [{ target: "FACT", payload: { kind: "FINANCE", body: "שכר ב-9 לחודש" } }],
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
      items: [{ target: "FACT", action: "CONTRADICT", targetId: bank.id, payload: { kind: "FINANCE", body: "הבנק בישראל: הפועלים" }, at: "21:30" }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    expect(p.existing?.body).toBe("הבנק בישראל: לאומי");
    await approveProposal(user, p.id);
    const after = await prisma.clientFact.findUniqueOrThrow({ where: { id: bank.id } });
    expect(after.body).toBe("הבנק בישראל: לאומי");
    expect(after.knowledgeStatus).toBe("UNCERTAIN");
    expect(after.alternatives).toEqual([expect.objectContaining({ value: "הבנק בישראל: הפועלים", sources: [{ code: "S2", at: "21:30" }] })]);
  });

  it("flags what is already in the file, and a rejection needs a reason", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" });
    await addClientFact(user, { clientId: client.id, kind: "REQUIREMENT", body: "כל תהליך מתועד עם Owner ו-SLA", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: { code: "s1" },
      items: [{ target: "FACT", payload: { kind: "REQUIREMENT", body: "כל תהליך מתועד עם owner ו SLA." } }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    expect(p.flags).toEqual([expect.objectContaining({ code: "DUPLICATE" })]);
    await expect(rejectProposal(user, p.id, " ")).rejects.toThrow("למה");
    const rejected = await rejectProposal(user, p.id, "כבר בתיק");
    expect(rejected.state).toBe("REJECTED");
  });

  it("decides several at once, each as on its own; what changes the file or may be there already waits for one at a time", async () => {
    const { client, user } = await setup();
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" });
    await addClientFact(user, { clientId: client.id, kind: "REQUIREMENT", body: "דוח שבועי לאורן", sources: [{ code: "S1" }] });
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "FACT", payload: { kind: "NOTE", body: "9 עובדים שכירים בישראל" } },
        { target: "FACT", payload: { kind: "NOTE", body: "SOC 2 הושג" } },
        { target: "FACT", payload: { kind: "REQUIREMENT", body: "דוח שבועי לאורן" } },
        { target: "FACT", payload: { kind: "NOTE", body: "שיחת חולין" } },
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
    const other = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "עוד" } }] });
    const [mine] = (await listOpenBatches(user)).find((x) => x.id === other.batchId)!.proposals;
    expect((await decideProposals(stranger, [mine.id], { approve: true })).failed).toHaveLength(1);
  });

  it("is closed to anyone not assigned to the client, in both directions", async () => {
    const { client, user } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(proposeKnowledge(stranger, { clientId: client.id, source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] })).rejects.toBeInstanceOf(ForbiddenError);
    const r = await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] });
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
      items: [{ target: "REQUEST_TYPE", payload: { title: "חשבונית Inc", arrivesVia: "billing-us", handling: "לשני ולג'נן, לא לאיילה" }, at: "14:20" }],
    });
    const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
    const approved = await approveProposal(user, p.id);
    const rt = await prisma.requestType.findUniqueOrThrow({ where: { id: approved.resultId! } });
    expect(rt.handling).toBe("לשני ולג'נן, לא לאיילה");
    expect(rt.sources).toEqual([{ code: "S1", at: "14:20" }]);
  });

  it("lists the user's clients with their domains, and the recordings already proposed", async () => {
    const { extractionBrief } = await import("@/lib/app-domain/extraction-brief");
    const { addClientDomain } = await import("@/lib/app-domain/client-sources");
    const { client, user } = await setup();
    const other = await createTestClient({ name: "Not mine" });
    await addClientDomain(user, { clientId: client.id, domain: "nux.ai", kind: "CLIENT" });
    await addClientDomain(user, { clientId: client.id, domain: "nextage.co.il", kind: "PARTNER", organizationName: "Nextage" });
    await proposeKnowledge(user, { clientId: client.id, source: MEETING, items: [{ target: "FACT", payload: { kind: "NOTE", body: "x" } }] });

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
});
