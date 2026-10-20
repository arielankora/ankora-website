import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { listOpenBatches, mergeProposal, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { possibleDuplicates } from "@/lib/app-domain/name-duplicates";

// One person, one system, whatever the spelling: a new item whose name
// may be one in the file is flagged, Claude is told which, and the
// reviewer adds it to the existing item instead of a second one.

const S1 = [{ code: "S1" }];
const MEETING = { kind: "TRANSCRIPT" as const, title: "NUX weekly", occurredAt: new Date("2026-10-20T00:00:00Z"), externalIds: ["ff-dups"] };
type Flag = { code: string; match?: { id: string; name: string } };
const flagsOf = (p: { flags: unknown }) => (Array.isArray(p.flags) ? (p.flags as Flag[]) : []);

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
  const ayala = await addClientContact(user, { clientId: client.id, name: "איילה מנצור", role: "מנהלת חשבונות", relationship: "PROVIDER", emails: ["ayala@acc.co.il"], sources: S1 });
  const dor = await addSystemAccess(user, { clientId: client.id, systemName: "Washington Department of Revenue", accessStatus: "PENDING", sources: S1 });
  return { client, user, ayala, dor };
}

describe("names written otherwise", () => {
  it("flags the item it may be, tells Claude, and merges into it on the card", async () => {
    const { client, user, ayala, dor } = await setup();
    const r = await proposeKnowledge(user, {
      clientId: client.id,
      source: MEETING,
      items: [
        { target: "CONTACT", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", name: "איילה", role: "CFO", emails: ["ayala@nux.ai"] } },
        { target: "SYSTEM", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", systemName: "Washington DOR", accessStatus: "HAS_ACCESS" } },
        { target: "CONTACT", reason: "נאמר", payload: { knowledgeStatus: "CONFIRMED", name: "אורנה", role: "מנכ\"לית" } },
      ],
    });
    expect(r.possibleMatches).toEqual([
      { index: 0, target: "CONTACT", name: "איילה", existing: [{ id: ayala.id, name: "איילה מנצור" }] },
      { index: 1, target: "SYSTEM", name: "Washington DOR", existing: [{ id: dor.id, name: "Washington Department of Revenue" }] },
    ]);
    const [c, s, other] = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals;
    expect(flagsOf(c)).toContainEqual(expect.objectContaining({ code: "SIMILAR", match: { id: ayala.id, name: "איילה מנצור" } }));
    expect(flagsOf(other).some((f) => f.code === "DUPLICATE" || f.code === "SIMILAR")).toBe(false);

    // Added to Ayala: the full name stays, the emails add up, the role changes.
    expect(await mergeProposal(user, c.id, ayala.id)).toMatchObject({ resultId: ayala.id, state: "APPROVED" });
    const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: ayala.id }, include: { person: true } });
    expect(contact.role).toBe("CFO");
    expect(contact.person.name).toBe("איילה מנצור");
    expect(contact.person.emails.sort()).toEqual(["ayala@acc.co.il", "ayala@nux.ai"]);
    expect(await prisma.clientContact.count({ where: { clientId: client.id, deletedAt: null } })).toBe(1);

    await mergeProposal(user, s.id, dor.id);
    expect(await prisma.systemAccess.findUniqueOrThrow({ where: { id: dor.id } })).toMatchObject({ systemName: "Washington Department of Revenue", accessStatus: "HAS_ACCESS" });
    await expect(mergeProposal(user, s.id, dor.id)).rejects.toThrow("כבר הוחלט");
  });

  it("lists what is already twice in the file", async () => {
    const { client, user, ayala } = await setup();
    const short = await addClientContact(user, { clientId: client.id, name: "איילה", relationship: "PROVIDER", sources: S1 });
    await addClientContact(user, { clientId: client.id, name: "אורנה", relationship: "CLIENT_STAFF", sources: S1 });
    const pairs = await possibleDuplicates(user, client.id);
    expect(pairs.map((p) => [p.kind, p.a.id, p.b.id])).toEqual([["CONTACT", ayala.id, short.id]]);
  });
});
