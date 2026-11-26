import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import {
  activateOnboardingClient,
  addOnboardingContact,
  addOnboardingDomain,
  addOnboardingPartner,
  addOnboardingRule,
  addOnboardingSource,
  confirmNoSpecialRules,
  listOnboarding,
  onboardingState,
  removeOnboardingPartner,
  setOnboardingChannel,
  setOnboardingTeam,
  startClientOnboarding,
  updateOnboardingContact,
} from "@/lib/app-domain/client-onboarding";
import { addClientOrganization } from "@/lib/app-domain/client-contacts";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { extractionBrief } from "@/lib/app-domain/extraction-brief";
import { DomainError } from "@/lib/domain-error";

// New-client wizard, part two (26.11.2026): a client is created at the end
// of step 1 as ONBOARDING, filled step by step, and activated only when
// what the automation needs is there.

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof DomainError ? err.code : String(err);
  }
  return "no error";
};

async function people() {
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: backup } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  return { manager, backup, employee };
}

async function filledBusiness() {
  const p = await people();
  const client = await startClientOnboarding(p.manager, { name: "חברת דוגמה", kind: "BUSINESS", aiExcluded: false });
  await addOnboardingDomain(p.manager, client.id, "example-onb.co.il");
  await setOnboardingChannel(p.manager, client.id, { preferredChannel: "WHATSAPP" });
  await addOnboardingContact(p.manager, client.id, { name: "דנה כהן", role: "תפעול", emails: ["dana@example-onb.co.il"], isPrimary: true, isDecisionMaker: true });
  await confirmNoSpecialRules(p.manager, client.id, true);
  await setOnboardingTeam(p.manager, client.id, { accountManagerId: p.manager.id, backupManagerId: p.backup.id });
  return { ...p, client };
}

describe("starting a setup", () => {
  it("creates the client as ONBOARDING, with the AI decision and a setup source", async () => {
    const { manager } = await people();
    const client = await startClientOnboarding(manager, { name: "פרטי", kind: "PRIVATE", aiExcluded: true });
    expect(client.status).toBe("ONBOARDING");
    expect(client.aiExcluded).toBe(true);
    const state = await onboardingState(manager, client.id);
    expect(state.step).toBe(1);
    expect(state.sources.map((s) => s.code)).toEqual(["S1"]);
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: client.id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["client.create", "client.ai_excluded"]));
  });

  it("refuses a setup without the AI decision, and an employee", async () => {
    const { manager, employee } = await people();
    expect(await codeOf(startClientOnboarding(manager, { name: "x", kind: "BUSINESS" } as never))).toBe("clientOnboarding.aiDecisionRequired");
    await expect(startClientOnboarding(employee, { name: "x", kind: "BUSINESS", aiExcluded: false })).rejects.toThrow();
    expect(await prisma.client.count()).toBe(0);
  });
});

describe("filling a setup", () => {
  it("says what is still missing, step by step, until it is ready", async () => {
    const { manager, backup } = await people();
    const client = await startClientOnboarding(manager, { name: "חברת דוגמה", kind: "BUSINESS", aiExcluded: false });
    expect((await onboardingState(manager, client.id)).missing.map((m) => m.code)).toEqual([
      "domainOrPersonalEmail",
      "preferredChannel",
      "contact",
      "rulesDecided",
      "accountManager",
      "backupManager",
    ]);

    await addOnboardingDomain(manager, client.id, "example-onb.co.il");
    await setOnboardingChannel(manager, client.id, { preferredChannel: "EMAIL" });
    const contact = await addOnboardingContact(manager, client.id, { name: "יואב" });
    expect((await onboardingState(manager, client.id)).missing.map((m) => m.code)).toEqual(["contactReachable", "rulesDecided", "accountManager", "backupManager"]);

    await updateOnboardingContact(manager, client.id, contact.id, { phones: ["050-0000002"] });
    await addOnboardingRule(manager, client.id, { kind: "DATA_HANDLING", title: "בלי מידע רפואי", statement: "מידע רפואי על עובדים לא נכנס לתיק." });
    expect(await codeOf(setOnboardingTeam(manager, client.id, { accountManagerId: manager.id, backupManagerId: manager.id }))).toBe("clients.backupSameAsManager");
    await setOnboardingTeam(manager, client.id, { accountManagerId: manager.id, backupManagerId: backup.id });

    const state = await onboardingState(manager, client.id);
    expect(state.ready).toBe(true);
    expect(state.step).toBe(4);
    expect(state.rules.map((r) => r.status)).toEqual(["PROPOSED"]);
  });

  it("changes only the address shown when a shared person is edited", async () => {
    const { manager } = await people();
    const client = await startClientOnboarding(manager, { name: "x", kind: "BUSINESS", aiExcluded: false });
    const contact = await addOnboardingContact(manager, client.id, { name: "דנה", emails: ["a@example-onb.co.il"] });
    await prisma.person.update({ where: { id: contact.personId }, data: { emails: ["a@example-onb.co.il", "b@other-onb.co.il"] } });
    await updateOnboardingContact(manager, client.id, contact.id, { emails: ["c@example-onb.co.il"] });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: contact.personId } })).emails).toEqual(["c@example-onb.co.il", "b@other-onb.co.il"]);
  });

  it("refuses 'no special rules' while there is a rule", async () => {
    const { manager } = await people();
    const client = await startClientOnboarding(manager, { name: "x", kind: "BUSINESS", aiExcluded: false });
    await addOnboardingRule(manager, client.id, { kind: "DISCLOSURE", title: "מחירים", statement: "לא משתפים מחירי ספקים." });
    expect(await codeOf(confirmNoSpecialRules(manager, client.id, true))).toBe("clientOnboarding.hasRules");
  });

  it("registers a partner's domain as a partner domain, and removes it with the partner", async () => {
    const { manager } = await people();
    const client = await startClientOnboarding(manager, { name: "x", kind: "BUSINESS", aiExcluded: false });
    const partner = await addOnboardingPartner(manager, client.id, { name: "משרד רו\"ח לדוגמה", domain: "cpa-onb.co.il", role: "רואה חשבון" });
    expect((await prisma.clientDomain.findMany({ where: { clientId: client.id, deletedAt: null } })).map((d) => [d.domain, d.kind])).toEqual([["cpa-onb.co.il", "PARTNER"]]);
    await removeOnboardingPartner(manager, client.id, partner.id);
    expect(await prisma.clientDomain.count({ where: { clientId: client.id, deletedAt: null } })).toBe(0);
  });

  it("marks what came from another source than the setup", async () => {
    const { manager } = await people();
    const client = await startClientOnboarding(manager, { name: "x", kind: "BUSINESS", aiExcluded: false });
    const email = await addOnboardingSource(manager, client.id, { kind: "EMAIL", title: "מייל מהלקוח, 20.11" });
    expect((await addOnboardingSource(manager, client.id, { kind: "EMAIL", title: "מייל מהלקוח, 20.11" })).code).toBe(email.code);
    await addOnboardingContact(manager, client.id, { name: "עוזרת", emails: ["assist@example-onb.co.il"], sources: [{ code: email.code }] });
    await addOnboardingContact(manager, client.id, { name: "דנה", emails: ["dana@example-onb.co.il"] });
    const state = await onboardingState(manager, client.id);
    expect(state.contacts.map((c) => [c.name, c.source])).toEqual([
      ["עוזרת", "מייל מהלקוח, 20.11"],
      ["דנה", null],
    ]);
  });

  it("lists the setups with what each still needs", async () => {
    const { manager, client } = await filledBusiness();
    await startClientOnboarding(manager, { name: "חדש", kind: "PRIVATE", aiExcluded: false });
    const list = await listOnboarding(manager);
    expect(list.map((s) => [s.name, s.ready])).toEqual(
      expect.arrayContaining([
        ["חברת דוגמה", true],
        ["חדש", false],
      ]),
    );
    expect(list.find((s) => s.id === client.id)?.lastEditedBy).toBe(manager.name);
  });
});

describe("activation", () => {
  it("is refused while something is missing, with what is missing", async () => {
    const { manager } = await people();
    const client = await startClientOnboarding(manager, { name: "x", kind: "BUSINESS", aiExcluded: false });
    const err = await activateOnboardingClient(manager, client.id).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("clientOnboarding.notReady");
    expect(err.message).toContain("אחראי באנקורה");
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).status).toBe("ONBOARDING");
  });

  it("makes the client active, gives the team access, and puts it in front of the automation", async () => {
    const { manager, backup, client } = await filledBusiness();
    expect((await listAccessibleClients(backup)).map((c) => c.id)).not.toContain(client.id);

    await activateOnboardingClient(manager, client.id);

    const after = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.onboardingStep).toBeNull();
    expect(after.activatedAt).not.toBeNull();
    expect((await listAccessibleClients(backup)).map((c) => c.id)).toContain(client.id);
    const brief = await extractionBrief(manager);
    expect(brief.clients.find((c) => c.name === "חברת דוגמה")?.domains.map((d) => d.domain)).toEqual(["example-onb.co.il"]);
    expect(await codeOf(addOnboardingDomain(manager, client.id, "more-onb.co.il"))).toBe("clientOnboarding.notOnboarding");
  });
});

describe("partner domains outside setup", () => {
  it("adding an organization with a domain to a file lists the domain for the extraction", async () => {
    const { manager } = await people();
    const client = await createTestClient({ name: "פעיל" });
    await addClientOrganization(manager, { clientId: client.id, name: "עורכי דין לדוגמה", domains: ["law-onb.co.il", "gmail.com"], sources: [], knowledgeStatus: "MISSING", toResolve: "מאיפה" });
    const domains = await prisma.clientDomain.findMany({ where: { clientId: client.id, deletedAt: null } });
    expect(domains.map((d) => [d.domain, d.kind])).toEqual([["law-onb.co.il", "PARTNER"]]);
  });
});
