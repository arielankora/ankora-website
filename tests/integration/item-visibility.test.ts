import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess, updateSystemAccess } from "@/lib/app-domain/system-map";
import { addClientFact, supersedeClientFact } from "@/lib/app-domain/client-facts";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { buildClientFile } from "@/lib/app-domain/client-file-view";

// Spec 3.1: "visible to the client" and the item's owner. What is worth
// holding: nothing becomes visible that may not be; an item that becomes
// sensitive stops being visible; an owner is someone at Ankora; a new
// version of a fact keeps both; and a proposal can name both, by name.

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: created } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  // A name to propose by, unique to this test.
  const user = await prisma.user.update({ where: { id: created.id }, data: { name: `הדס ${created.id}` } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  return { client, user };
}

describe("visible to the client, and owner", () => {
  it("only what may be shown, and it stops when the item becomes sensitive", async () => {
    const { client, user } = await setup();
    const sys = await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", sources: S1, clientVisible: true, ownerId: user.id });
    expect(sys).toMatchObject({ clientVisible: true, ownerId: user.id });
    await expect(addSystemAccess(user, { clientId: client.id, systemName: "Rippling", sources: S1, clientVisible: true, sensitivity: "SENSITIVE" })).rejects.toThrow("רגיש");
    await expect(addSystemAccess(user, { clientId: client.id, systemName: "Doka", sources: S1, doNotDisclose: "לא לספר לאורן", clientVisible: true })).rejects.toThrow("לא לספר");

    // Restricted later: no longer shown, without anyone having to remember.
    const after = await updateSystemAccess(user, sys.id, { audience: "ACCOUNT_TEAM" });
    expect(after.clientVisible).toBe(false);
    // An update that says nothing about the owner keeps it.
    expect(after.ownerId).toBe(user.id);

    const { user: portal } = await createTestUser({ role: "CLIENT_USER" });
    await expect(updateSystemAccess(user, sys.id, { ownerId: portal.id })).rejects.toThrow("איש צוות");
  });

  it("a new version of a fact keeps who keeps it and whether the client sees it", async () => {
    const { client, user } = await setup();
    const fact = await addClientFact(user, { clientId: client.id, kind: "PREFERENCE", body: "WhatsApp קודם", sources: S1, clientVisible: true, ownerId: user.id });
    const next = await supersedeClientFact(user, fact.id, { kind: "PREFERENCE", body: "Slack קודם", sources: S1 });
    expect(next).toMatchObject({ clientVisible: true, ownerId: user.id });

    const file = await buildClientFile(user, client.id, { audience: "staff" });
    const line = file.sections.flatMap((s) => s.items).find((i) => i.text.includes("Slack קודם"));
    expect(line).toMatchObject({ clientVisible: true, owner: user.name });
    expect(file.control?.map((p) => p.text)).toContain("פריט אחד גלוי ללקוח");
  });

  it("a proposal names both, and an owner nobody is called is flagged and left out", async () => {
    const { client, user } = await setup();
    const sent = await proposeKnowledge(user, {
      clientId: client.id,
      source: { code: "S1" },
      items: [
        { target: "SYSTEM", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", systemName: "Mercury", clientVisible: true, ownerName: user.name } },
        { target: "SYSTEM", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", systemName: "Brex", ownerName: "מישהו אחר" } },
      ],
    });
    const [batch] = await listOpenBatches(user, { clientId: client.id });
    const [mercury, brex] = batch.proposals;
    expect((brex.flags as { code: string }[]).map((f) => f.code)).toContain("OWNER");
    await approveProposal(user, mercury.id, { clientVisible: true, ownerName: user.name });
    await approveProposal(user, brex.id);
    const rows = await prisma.systemAccess.findMany({ where: { clientId: client.id }, orderBy: { systemName: "asc" } });
    expect(rows.map((r) => [r.systemName, r.clientVisible, r.ownerId])).toEqual([
      ["Brex", false, null],
      ["Mercury", true, user.id],
    ]);
    // Approving as it came is not an edit (decision 1's count).
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: mercury.id } })).edited).toBe(false);
    expect(sent.proposed).toBe(2);
  });
});
