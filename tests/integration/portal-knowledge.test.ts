import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser } from "./factories";
import { getPortalFile } from "@/lib/app-domain/client-file";

// The client file in the portal (lib/portal-knowledge.ts). What is worth
// holding: a client sees only their own client's items, only those marked
// visible, never a sensitive, restricted or not-to-tell one even if marked,
// and nothing of another client's file.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const other = await createTestClient({ name: "Zest" });
  const { user } = await createTestClientUser({ clientId: client.id });
  return { client, other, user };
}

describe("the client file in the portal", () => {
  it("shows what was marked visible, and only what may be shown", async () => {
    const { client, other, user } = await setup();
    await prisma.systemAccess.createMany({
      data: [
        { clientId: client.id, systemName: "Mercury", purpose: "בנק", accessStatus: "PENDING", clientVisible: true },
        { clientId: client.id, systemName: "Rippling", clientVisible: false },
        { clientId: client.id, systemName: "Brex", clientVisible: true, sensitivity: "SENSITIVE" },
        { clientId: client.id, systemName: "Ramp", clientVisible: true, audience: "RESTRICTED" },
        { clientId: client.id, systemName: "Doka", clientVisible: true, doNotDisclose: "לא לספר לאורן" },
        { clientId: other.id, systemName: "Zest Bank", clientVisible: true },
      ],
    });
    await prisma.clientFact.create({ data: { clientId: client.id, kind: "PREFERENCE", body: "WhatsApp קודם", clientVisible: true, knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את אורן" } });
    const p = await prisma.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "תשלומי ספקים", transitionStatus: "IN_HANDOVER", clientVisible: true } });
    await prisma.importantDate.create({
      data: { clientId: client.id, title: "פעימה", type: "custom", category: "BUSINESS_FINANCE", month: 1, day: 10, recurrence: "MONTHLY", responsibleUserId: (await prisma.user.findFirstOrThrow()).id, processId: p.id, nextOccurrenceAt: new Date(Date.now() + 5 * 86_400_000) },
    });

    const { knowledge } = await getPortalFile(user);
    const by = Object.fromEntries(knowledge.map((g) => [g.key, g.items]));
    expect(by.systems.map((i) => i.text)).toEqual(["Mercury"]);
    expect(by.systems[0]).toMatchObject({ tag: "ממתינים לגישה" });
    expect(by.facts).toEqual([expect.objectContaining({ text: "WhatsApp קודם", askToConfirm: true })]);
    // Our working note on it never reaches the client.
    expect(JSON.stringify(knowledge)).not.toContain("לשאול את אורן");
    expect(by.processes[0]).toMatchObject({ text: "תשלומי ספקים", tag: "בחפיפה אלינו" });
    expect(by.processes[0].detail).toContain("הבא:");
  });

  // 28.10.2026: the people group had never had anyone in it in a test, so
  // the two lines that carry a contact's and an organisation's name into
  // it had never run (the coverage floor's finding on run #606).
  it("lists the people and organisations marked visible, under their names", async () => {
    const { client, user } = await setup();
    const shown = await prisma.person.create({ data: { name: "אורן לוי" } });
    const hidden = await prisma.person.create({ data: { name: "דנה כהן" } });
    const bank = await prisma.organization.create({ data: { name: "בנק הפועלים" } });
    await prisma.clientContact.createMany({
      data: [
        { clientId: client.id, personId: shown.id, role: "סמנכ״ל כספים", clientVisible: true },
        { clientId: client.id, personId: hidden.id, role: "יועצת", clientVisible: false },
      ],
    });
    await prisma.clientOrganization.create({ data: { clientId: client.id, organizationId: bank.id, role: "בנק עיקרי", clientVisible: true } });

    const { knowledge } = await getPortalFile(user);
    const people = knowledge.find((g) => g.key === "people")!.items;
    expect(people).toEqual([
      expect.objectContaining({ text: "אורן לוי", detail: "סמנכ״ל כספים" }),
      expect.objectContaining({ text: "בנק הפועלים", detail: "בנק עיקרי" }),
    ]);
    expect(JSON.stringify(knowledge)).not.toContain("דנה כהן");
  });
});
