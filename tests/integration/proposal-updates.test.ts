import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { addProcess, saveProcessVersion } from "@/lib/app-domain/processes";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";

// A proposal that changes an item already in the file, not only a fact:
// only what it says changes, the sources add up, nothing is duplicated.

const S1 = [{ code: "S1" }];
const MEETING = { kind: "TRANSCRIPT" as const, title: "NUX weekly", occurredAt: new Date("2026-10-19T00:00:00Z"), externalIds: ["ff-updates"] };
type Flag = { code: string };
const flagsOf = (p: { flags: unknown }) => (Array.isArray(p.flags) ? (p.flags as Flag[]) : []);

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
  const ayala = await addClientContact(user, { clientId: client.id, name: "איילה מנצור", role: "מנהלת חשבונות", relationship: "PROVIDER", sources: S1 });
  const doka = await addSystemAccess(user, { clientId: client.id, systemName: "Doka", accessStatus: "PENDING", purpose: "חשבוניות", sources: S1 });
  const rule = await addClientPolicy(user, { clientId: client.id, kind: "INFO", title: "דיווח", statement: "דוח חודשי לאורן", sources: S1 });
  const p1 = await addProcess(user, { clientId: client.id, title: "תשלומי ספקים", sources: S1 });
  await saveProcessVersion(user, p1.id, { steps: [{ title: "להעלות" }], baseVersion: 0 });
  return { client, user, ayala, doka, rule, p1 };
}

describe("a proposal that changes an item", () => {
  it("updates contacts, systems, rules and processes in place, with only what changed", async () => {
    const { client, user, ayala, doka, rule, p1 } = await setup();
    // Claude finds the ids in its version of the file.
    const md = toMarkdown(await buildClientFile(user, client.id, { audience: "ai" }));
    expect(md).toContain(`(id: ${ayala.id})`);
    expect(md).toContain(`(id: ${doka.id})`);

    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "CONTACT", action: "SUPERSEDE", targetId: ayala.id, reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", role: "CFO" }, at: "02:00" },
        { target: "SYSTEM", action: "SUPERSEDE", targetId: doka.id, reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", accessStatus: "HAS_ACCESS" } },
        { target: "POLICY", action: "SUPERSEDE", targetId: rule.id, reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", statement: "דוח שבועי לאורן" } },
        { target: "PROCESS", action: "SUPERSEDE", targetId: p1.id, reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", slaText: "יומיים לפני", steps: [{ title: "להעלות" }, { title: "לשלוח לאיילה" }] } },
        { target: "SYSTEM", action: "SUPERSEDE", targetId: "nope", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", accessStatus: "HAS_ACCESS" } },
      ],
    });
    expect(r.proposed).toBe(4);
    expect(r.dropped).toEqual([expect.objectContaining({ index: 4 })]);
    const [c, s, pol, proc] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    // The card shows the item as it is now, and no "already in the file".
    expect(c.existing?.body).toContain("איילה מנצור");
    expect(flagsOf(c).some((f) => f.code === "DUPLICATE")).toBe(false);

    expect(await approveProposal(user, c.id)).toMatchObject({ resultId: ayala.id });
    const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: ayala.id } });
    expect(contact.role).toBe("CFO");
    expect(contact.relationship).toBe("PROVIDER");
    expect(contact.sources).toEqual([{ code: "S1" }, { code: "S2", at: "02:00" }]);

    await approveProposal(user, s.id);
    expect(await prisma.systemAccess.findUniqueOrThrow({ where: { id: doka.id } })).toMatchObject({ accessStatus: "HAS_ACCESS", purpose: "חשבוניות" });

    await approveProposal(user, pol.id);
    const after = await prisma.clientPolicy.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after).toMatchObject({ statement: "דוח שבועי לאורן", status: "PROPOSED", title: "דיווח" });

    await approveProposal(user, proc.id);
    expect((await prisma.process.findUniqueOrThrow({ where: { id: p1.id } })).slaText).toBe("יומיים לפני");
    const versions = await prisma.processVersion.findMany({ where: { processId: p1.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => (v.steps as unknown[]).length)).toEqual([1, 2]);

    // Nothing was added beside them.
    expect(await prisma.clientContact.count({ where: { clientId: client.id, deletedAt: null } })).toBe(1);
    expect(await prisma.systemAccess.count({ where: { clientId: client.id, deletedAt: null } })).toBe(1);
  });
});
