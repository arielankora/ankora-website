import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { proposalStatsForAi } from "@/lib/app-domain/proposal-stats";

// Approve with edits (3.11.2026, lib/proposal-edits.ts): the proposal
// keeps the names of the fields that changed, the audit row of the
// approval keeps their values before and after and whether the change was
// to the wording or to a fact, and get_proposal_stats reads the names and
// the kind, never the values.

const MEETING = { kind: "TRANSCRIPT" as const, title: "Nextage & Ankora", occurredAt: new Date("2026-10-12T00:00:00Z"), externalIds: ["ff-edit-1"] };

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "SUPER_ADMIN" });
  const r = await proposeKnowledge(user, {
    clientId: client.id,
    source: MEETING,
    items: [
      { target: "CONTACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", name: "שני הלוי", role: "VP Finance", emails: ["shani@nextage.co.il"], relationship: "PROVIDER" } },
      { target: "FACT", reason: "אורן אמר במפורש", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", topic: "COMMUNICATION", body: "WhatsApp, אחר כך Slack, אחר כך מייל" } },
      { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", topic: "COMMUNICATION", body: "הדוח נשלח ב-10 לחודש" } },
    ],
  });
  const [batch] = (await listOpenBatches(user, { clientId: client.id })).filter((b) => b.id === r.batchId);
  const [contact, pref, note] = batch.proposals;
  return { user, contact, pref, note };
}

const auditOf = (id: string) => prisma.auditEvent.findFirstOrThrow({ where: { entityType: "KnowledgeProposal", entityId: id, action: "knowledge_proposal.approve" } });

describe("approve with edits: which fields changed, and how", () => {
  it("stores the field names on the proposal and the values before and after in the audit row", async () => {
    const { user, contact, pref, note } = await setup();

    // As the form sends it: every field on the card, the unchanged ones too.
    await approveProposal(user, contact.id, { name: "שני הלוי", role: "סמנכ״לית כספים", notes: null, clientVisible: false });
    const c = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: contact.id } });
    expect(c).toMatchObject({ edited: true, editedFields: ["role"] });
    const ca = await auditOf(contact.id);
    expect(ca.beforeJson).toEqual({ fields: { role: "VP Finance" } });
    expect(ca.afterJson).toMatchObject({ edited: true, editedFields: ["role"], editKind: "FACT", fieldKinds: { role: "FACT" }, fields: { role: "סמנכ״לית כספים" } });

    // Reworded, same meaning: WORDING. Extra spaces alone are no edit.
    await approveProposal(user, pref.id, { body: "WhatsApp, ואחר כך Slack, ואחר כך מייל" });
    expect(await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: pref.id } })).toMatchObject({ edited: true, editedFields: ["body"] });
    expect((await auditOf(pref.id)).afterJson).toMatchObject({ editKind: "WORDING", fieldKinds: { body: "WORDING" } });

    // A changed day in the same sentence is a fact.
    await approveProposal(user, note.id, { body: "הדוח נשלח ב-15 לחודש" });
    expect((await auditOf(note.id)).afterJson).toMatchObject({ editedFields: ["body"], editKind: "FACT" });

    const stats = await proposalStatsForAi(user, { rows: true });
    const rows = Object.fromEntries(stats.rows!.map((r) => [r.id, r]));
    expect(rows[contact.id]).toMatchObject({ editedFields: ["role"], editKind: "FACT" });
    expect(rows[pref.id]).toMatchObject({ editedFields: ["body"], editKind: "WORDING" });
    const text = JSON.stringify(stats);
    expect(text).not.toContain("VP Finance");
    expect(text).not.toContain("סמנכ״לית");
  });

  it("an approval with nothing changed but spaces is no edit, and leaves no values in the audit row", async () => {
    const { user, pref } = await setup();
    await approveProposal(user, pref.id, { body: "  WhatsApp,  אחר כך Slack, אחר כך מייל " });
    expect(await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: pref.id } })).toMatchObject({ edited: false, editedFields: [] });
    const a = await auditOf(pref.id);
    expect(a.beforeJson).toBeNull();
    expect(a.afterJson).toMatchObject({ edited: false });
    expect(a.afterJson).not.toHaveProperty("editedFields");
  });
});
