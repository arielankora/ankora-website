import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import {
  archiveClient,
  discardOnboardingClient,
  listAccessibleClients,
  listClients,
  listOnboardingClients,
  restoreClient,
  updateClient,
} from "@/lib/app-domain/clients";
import { extractionBrief } from "@/lib/app-domain/extraction-brief";
import { lookupContact } from "@/lib/app-domain/client-contacts";
import { addClientDomain, clientsForEmail } from "@/lib/app-domain/client-sources";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";
import { clientFileAttentionFor } from "@/lib/app-domain/client-file-attention";
import { startTimer } from "@/lib/app-domain/time-entries";
import { lookupClient } from "@/lib/mcp/lookup";
import { resolveClients } from "@/lib/app-domain/agents";
import { DomainError } from "@/lib/domain-error";

// New-client wizard, part one (26.11.2026): a client being set up
// (ClientStatus.ONBOARDING) exists in the database with real contacts,
// numbers and domains, and nothing that runs on its own may reach it until
// it is activated: not the extraction, not the agents, not the existing
// connector tools, not the WhatsApp and call matching, not the timer, not
// the weekly file reminder. Leaving the status goes through the activation
// only.

const PHONE = "+972500000001";
const EMAIL = "dana@onboarding-example.co.il";

async function setup() {
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const active = await createTestClient({ name: "לקוח פעיל" });
  const onboarding = await prisma.client.create({
    data: { name: "לקוח בהקמה", status: "ONBOARDING", accountManagerId: manager.id },
  });
  for (const c of [active, onboarding]) {
    await prisma.userClientAccess.create({ data: { userId: employee.id, clientId: c.id } });
  }
  await prisma.clientDomain.create({ data: { clientId: onboarding.id, domain: "onboarding-example.co.il", kind: "CLIENT" } });
  const person = await prisma.person.create({ data: { name: "דנה", emails: [EMAIL], phones: [PHONE] } });
  await prisma.clientContact.create({ data: { clientId: onboarding.id, personId: person.id } });
  return { manager, employee, active, onboarding, person };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof DomainError ? err.code : String(err);
  }
  return "no error";
};

describe("a client being set up reaches nothing that runs on its own", () => {
  it("is left out of the working set, for a manager and for an assigned employee", async () => {
    const { manager, employee, active, onboarding } = await setup();
    for (const actor of [manager, employee]) {
      const ids = (await listAccessibleClients(actor)).map((c) => c.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(onboarding.id);
    }
  });

  it("is not in the extraction brief, by name or by domain", async () => {
    const { manager } = await setup();
    const brief = await extractionBrief(manager);
    expect(brief.clients.map((c) => c.name)).not.toContain("לקוח בהקמה");
    expect(JSON.stringify(brief)).not.toContain("onboarding-example.co.il");
  });

  it("is not found by the connector's client lookup or by lookup_contact", async () => {
    const { manager } = await setup();
    expect((await lookupClient(manager, "לקוח בהקמה")).ok).toBe(false);
    expect(await lookupContact(manager, EMAIL)).toEqual([]);
    expect(await lookupContact(manager, PHONE)).toEqual([]);
  });

  it("is not matched to an email by its domain", async () => {
    const { manager } = await setup();
    expect(await clientsForEmail(manager, EMAIL)).toEqual([]);
  });

  it("is not handed to an agent that runs on all of the user's clients", async () => {
    const { manager, active } = await setup();
    const agent = await prisma.agent.findFirst();
    const clients = await resolveClients(manager, agent?.id ?? "no-agent", [], { clientScope: "ALL_MINE", clientIds: [] });
    expect(clients.map((c) => c.name)).toEqual([active.name]);
  });

  it("is not matched to a WhatsApp conversation or a call by its contacts' numbers", async () => {
    const { active, person } = await setup();
    expect((await matchPhones([PHONE])).get(PHONE)?.clients ?? []).toEqual([]);

    // The same person in an active client's file is still matched there.
    await prisma.clientContact.create({ data: { clientId: active.id, personId: person.id } });
    expect((await matchPhones([PHONE])).get(PHONE)?.clients.map((c) => c.id)).toEqual([active.id]);
  });

  it("gets no weekly file reminder", async () => {
    const { manager, active, onboarding } = await setup();
    await prisma.client.update({ where: { id: active.id }, data: { accountManagerId: manager.id } });
    for (const c of [active, onboarding]) {
      await prisma.clientFact.create({ data: { clientId: c.id, kind: "QUESTION", body: "מי מאשר תשלומים?" } });
    }
    const attention = await clientFileAttentionFor(manager.id);
    expect([...attention.keys()]).toEqual([active.id]);
  });

  it("takes no time entry", async () => {
    const { employee, onboarding } = await setup();
    const category = await createTestCategory({ clientId: onboarding.id });
    await expect(startTimer(employee, { clientId: onboarding.id, categoryId: category.id })).rejects.toThrow();
    expect(await prisma.timeEntry.count({ where: { clientId: onboarding.id } })).toBe(0);
  });
});

describe("the client list", () => {
  it("lists a client being set up only in its own section", async () => {
    const { manager, active, onboarding } = await setup();
    expect((await listClients()).map((c) => c.id)).toEqual([active.id]);
    expect((await listOnboardingClients(manager)).map((c) => c.id)).toEqual([onboarding.id]);
  });

  it("leaves out a setup that was discarded", async () => {
    const { manager, onboarding } = await setup();
    await discardOnboardingClient(manager, onboarding.id);
    expect(await listOnboardingClients(manager)).toEqual([]);
  });
});

describe("leaving setup goes through the activation only", () => {
  it("refuses every other change of status, in both directions", async () => {
    const { manager, active, onboarding } = await setup();
    expect(await codeOf(updateClient(manager, onboarding.id, { status: "ACTIVE" }))).toBe("clients.onboardingStatusLocked");
    expect(await codeOf(archiveClient(manager, onboarding.id))).toBe("clients.onboardingStatusLocked");
    expect(await codeOf(restoreClient(manager, onboarding.id))).toBe("clients.onboardingStatusLocked");
    expect(await codeOf(updateClient(manager, active.id, { status: "ONBOARDING" }))).toBe("clients.cannotReturnToOnboarding");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: onboarding.id } })).status).toBe("ONBOARDING");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("ACTIVE");
  });

  it("still saves the other settings of a client being set up", async () => {
    const { manager, onboarding } = await setup();
    await updateClient(manager, onboarding.id, { industry: "נדל\"ן" });
    const after = await prisma.client.findUniqueOrThrow({ where: { id: onboarding.id } });
    expect(after.industry).toBe("נדל\"ן");
    expect(after.status).toBe("ONBOARDING");
  });
});

describe("discarding a setup", () => {
  it("releases its domains, so another client can register them", async () => {
    const { manager, active, onboarding } = await setup();
    expect(await codeOf(addClientDomain(manager, { clientId: active.id, domain: "onboarding-example.co.il", kind: "CLIENT" }))).toBe(
      "clientSources.domainOfOtherClient",
    );

    await discardOnboardingClient(manager, onboarding.id);

    expect((await prisma.client.findUniqueOrThrow({ where: { id: onboarding.id } })).deletedAt).not.toBeNull();
    await addClientDomain(manager, { clientId: active.id, domain: "onboarding-example.co.il", kind: "CLIENT" });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: onboarding.id, action: "client.onboarding_discard" } });
    expect(audit).not.toBeNull();
  });

  it("is refused for an active client, and for an employee", async () => {
    const { manager, employee, active, onboarding } = await setup();
    expect(await codeOf(discardOnboardingClient(manager, active.id))).toBe("clients.notOnboarding");
    await expect(discardOnboardingClient(employee, onboarding.id)).rejects.toThrow();
    expect((await prisma.client.findUniqueOrThrow({ where: { id: onboarding.id } })).deletedAt).toBeNull();
  });
});
