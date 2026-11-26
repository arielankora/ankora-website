import { describe, expect, it } from "vitest";
import { onboardingMissing, unreachableContacts, type OnboardingSnapshot } from "@/lib/client-onboarding";

// New-client wizard (26.11.2026): what a client needs before activation.

const ready: OnboardingSnapshot = {
  kind: "BUSINESS",
  clientDomains: 1,
  contacts: [{ name: "דנה", emails: 1, phones: 0 }],
  preferredChannel: "WHATSAPP",
  rules: 0,
  noSpecialRulesAt: new Date("2026-11-26T10:00:00Z"),
  accountManagerId: "u1",
  backupManagerId: "u2",
};

describe("onboardingMissing", () => {
  it("is empty for a client with everything the automation needs", () => {
    expect(onboardingMissing(ready)).toEqual([]);
  });

  it("asks a business for a domain, whatever its contacts' addresses", () => {
    expect(onboardingMissing({ ...ready, clientDomains: 0 })).toEqual(["domainOrPersonalEmail"]);
  });

  it("lets a private client stand on a contact's email instead of a domain", () => {
    expect(onboardingMissing({ ...ready, kind: "PRIVATE", clientDomains: 0 })).toEqual([]);
    expect(onboardingMissing({ ...ready, kind: "PRIVATE", clientDomains: 0, contacts: [{ name: "דנה", emails: 0, phones: 1 }] })).toEqual([
      "domainOrPersonalEmail",
    ]);
  });

  it("asks for a contact, and for an email or a phone on every contact", () => {
    expect(onboardingMissing({ ...ready, contacts: [] })).toEqual(["contact"]);
    const s = { ...ready, contacts: [...ready.contacts, { name: "יואב", emails: 0, phones: 0 }] };
    expect(onboardingMissing(s)).toEqual(["contactReachable"]);
    expect(unreachableContacts(s)).toEqual(["יואב"]);
  });

  it("takes a rule or an explicit 'no special rules', never silence", () => {
    expect(onboardingMissing({ ...ready, noSpecialRulesAt: null })).toEqual(["rulesDecided"]);
    expect(onboardingMissing({ ...ready, noSpecialRulesAt: null, rules: 2 })).toEqual([]);
  });

  it("asks for a channel, an account manager and a different backup", () => {
    expect(onboardingMissing({ ...ready, preferredChannel: null })).toEqual(["preferredChannel"]);
    expect(onboardingMissing({ ...ready, accountManagerId: null })).toEqual(["accountManager"]);
    expect(onboardingMissing({ ...ready, backupManagerId: null })).toEqual(["backupManager"]);
    expect(onboardingMissing({ ...ready, backupManagerId: "u1" })).toEqual(["distinctBackup"]);
  });
});
