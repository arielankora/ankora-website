// New-client wizard (26.11.2026): what a client being set up still needs
// before it can be activated, and why each thing matters. Pure, so the
// wizard's screen, the summary, the client list and the MCP tools all
// read the same list, and a unit test holds it.
//
// Each requirement is what one automation needs (Ariel's findings,
// 26.11.2026): the extraction matches a meeting by its participants'
// domains, WhatsApp and calls by the contacts' numbers, and the rules and
// the AI decision bind from the first minute.

export const ONBOARDING_STEPS = 4;

export type OnboardingRequirement =
  | "domainOrPersonalEmail"
  | "contact"
  | "contactReachable"
  | "preferredChannel"
  | "rulesDecided"
  | "accountManager"
  | "backupManager"
  | "distinctBackup";

export interface OnboardingSnapshot {
  kind: "BUSINESS" | "PRIVATE";
  clientDomains: number;
  contacts: { name: string | null; emails: number; phones: number }[];
  preferredChannel: string | null;
  rules: number;
  noSpecialRulesAt: Date | null;
  accountManagerId: string | null;
  backupManagerId: string | null;
}

/// The step of the wizard each requirement is filled in.
export const REQUIREMENT_STEP: Record<OnboardingRequirement, 1 | 2 | 3 | 4> = {
  domainOrPersonalEmail: 2,
  preferredChannel: 2,
  contact: 3,
  contactReachable: 3,
  rulesDecided: 4,
  accountManager: 4,
  backupManager: 4,
  distinctBackup: 4,
};

/// In Hebrew, as the screens and Claude say it.
export const REQUIREMENT_TEXT: Record<OnboardingRequirement, string> = {
  domainOrPersonalEmail: "דומיין של הלקוח, או ללקוח פרטי איש קשר עם דוא\"ל: בלי זה החילוץ לא ישייך אליו אף פגישה",
  preferredChannel: "ערוץ מועדף",
  contact: "לפחות איש קשר אחד",
  contactReachable: "דוא\"ל או נייד לכל איש קשר: בלי אחד מהם לא נדע לשייך אליו מיילים, וואטסאפ ושיחות",
  rulesDecided: "כללי טיפול במידע: לפחות כלל אחד, או אישור שאין ללקוח כללים מיוחדים",
  accountManager: "אחראי באנקורה",
  backupManager: "מחליף לאחראי",
  distinctBackup: "המחליף צריך להיות אדם אחר מהאחראי",
};

export function onboardingMissing(s: OnboardingSnapshot): OnboardingRequirement[] {
  const missing: OnboardingRequirement[] = [];
  const withEmail = s.contacts.some((c) => c.emails > 0);
  if (s.kind === "PRIVATE" ? !withEmail && s.clientDomains === 0 : s.clientDomains === 0) missing.push("domainOrPersonalEmail");
  if (!s.preferredChannel) missing.push("preferredChannel");
  if (s.contacts.length === 0) missing.push("contact");
  else if (s.contacts.some((c) => c.emails === 0 && c.phones === 0)) missing.push("contactReachable");
  if (s.rules === 0 && !s.noSpecialRulesAt) missing.push("rulesDecided");
  if (!s.accountManagerId) missing.push("accountManager");
  if (!s.backupManagerId) missing.push("backupManager");
  else if (s.accountManagerId && s.accountManagerId === s.backupManagerId) missing.push("distinctBackup");
  return missing;
}

/// The contacts that have neither an email nor a phone, by name, for the
/// sentence that says who is missing what.
export function unreachableContacts(s: Pick<OnboardingSnapshot, "contacts">): string[] {
  return s.contacts.filter((c) => c.emails === 0 && c.phones === 0).map((c) => c.name ?? "איש קשר בלי שם");
}
