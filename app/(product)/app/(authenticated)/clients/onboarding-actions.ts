"use server";
import { unexpectedActionError } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { discardOnboardingClient } from "@/lib/app-domain/clients";
import {
  activateOnboardingClient,
  addOnboardingContact,
  addOnboardingDomain,
  addOnboardingPartner,
  addOnboardingRule,
  confirmNoSpecialRules,
  removeOnboardingContact,
  removeOnboardingDomain,
  removeOnboardingPartner,
  removeOnboardingRule,
  setOnboardingChannel,
  setOnboardingTeam,
  startClientOnboarding,
  updateOnboardingContact,
  updateOnboardingIdentity,
  type RuleKindInSetup,
} from "@/lib/app-domain/client-onboarding";
import type { AppLocale, ClientChannel, ClientKind } from "@prisma/client";

// New-client wizard (26.11.2026): the screen's writes. Each one is a thin
// wrapper over lib/app-domain/client-onboarding.ts, which checks
// everything; the wrapper only reads the form and words the refusal.

export type SetupResult = { ok?: boolean; error?: string; clientId?: string };

async function failure(err: unknown): Promise<SetupResult> {
  const t = await getTranslations("clients.page.errors");
  if (err instanceof ForbiddenError) return { error: t("forbidden") };
  const domain = await domainErrorText(err);
  if (domain) return { error: domain };
  return { error: await unexpectedActionError(err, t("generic"), "clients/onboarding") };
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const list = (f: FormData, k: string) => (str(f, k) ? [str(f, k)] : []);

function refresh(clientId?: string) {
  revalidatePath("/app/clients");
  if (clientId) revalidatePath(`/app/clients/${clientId}/setup`);
}

async function run(clientId: string, write: () => Promise<unknown>): Promise<SetupResult> {
  try {
    await write();
  } catch (err) {
    return failure(err);
  }
  refresh(clientId);
  return { ok: true, clientId };
}

function kindOf(f: FormData): ClientKind {
  return str(f, "kind") === "PRIVATE" ? "PRIVATE" : "BUSINESS";
}

function localeOf(f: FormData): AppLocale {
  return str(f, "communicationLocale") === "en" ? "en" : "he";
}

/// "true", "false", or nothing chosen (undefined): the AI decision has no
/// default, so an unanswered radio is refused by the domain.
function aiOf(f: FormData): boolean | undefined {
  const v = str(f, "aiExcluded");
  return v === "true" ? true : v === "false" ? false : undefined;
}

export async function startOnboardingAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  try {
    const client = await startClientOnboarding(user, {
      name: str(f, "name"),
      kind: kindOf(f),
      industry: opt(f, "industry"),
      timezone: str(f, "timezone") || "Asia/Jerusalem",
      communicationLocale: localeOf(f),
      aiExcluded: aiOf(f) as boolean,
    });
    refresh(client.id);
    return { ok: true, clientId: client.id };
  } catch (err) {
    return failure(err);
  }
}

export async function updateIdentityAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () =>
    updateOnboardingIdentity(user, clientId, {
      name: str(f, "name"),
      kind: kindOf(f),
      industry: opt(f, "industry"),
      timezone: str(f, "timezone") || "Asia/Jerusalem",
      communicationLocale: localeOf(f),
      aiExcluded: aiOf(f),
    }),
  );
}

export async function addDomainAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => addOnboardingDomain(user, clientId, str(f, "domain")));
}

export async function removeDomainAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => removeOnboardingDomain(user, clientId, str(f, "id")));
}

export async function addPartnerAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => addOnboardingPartner(user, clientId, { name: str(f, "name"), domain: opt(f, "domain"), role: opt(f, "role") }));
}

export async function removePartnerAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => removeOnboardingPartner(user, clientId, str(f, "id")));
}

export async function setChannelAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  const channel = str(f, "preferredChannel");
  const preferredChannel = (["WHATSAPP", "EMAIL", "PHONE"].includes(channel) ? channel : null) as ClientChannel | null;
  return run(clientId, () => setOnboardingChannel(user, clientId, { preferredChannel, whatsappNumber: opt(f, "whatsappNumber") }));
}

export async function addContactAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () =>
    addOnboardingContact(user, clientId, {
      name: opt(f, "name"),
      role: opt(f, "role"),
      emails: list(f, "email"),
      phones: list(f, "phone"),
      isDecisionMaker: f.get("isDecisionMaker") === "on",
      isPrimary: f.get("isPrimary") === "on",
    }),
  );
}

export async function updateContactAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () =>
    updateOnboardingContact(user, clientId, str(f, "id"), {
      name: opt(f, "name"),
      role: opt(f, "role"),
      emails: list(f, "email"),
      phones: list(f, "phone"),
      isDecisionMaker: f.get("isDecisionMaker") === "on",
      isPrimary: f.get("isPrimary") === "on",
    }),
  );
}

export async function removeContactAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => removeOnboardingContact(user, clientId, str(f, "id")));
}

export async function addRuleAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  const kind = (str(f, "kind") === "DISCLOSURE" ? "DISCLOSURE" : "DATA_HANDLING") as RuleKindInSetup;
  return run(clientId, () => addOnboardingRule(user, clientId, { kind, title: str(f, "title"), statement: str(f, "statement") }));
}

export async function removeRuleAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => removeOnboardingRule(user, clientId, str(f, "id")));
}

export async function noSpecialRulesAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => confirmNoSpecialRules(user, clientId, f.get("confirmed") === "true"));
}

export async function setTeamAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => setOnboardingTeam(user, clientId, { accountManagerId: opt(f, "accountManagerId"), backupManagerId: opt(f, "backupManagerId") }));
}

export async function activateAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => activateOnboardingClient(user, clientId));
}

export async function discardOnboardingAction(_prev: SetupResult | undefined, f: FormData): Promise<SetupResult> {
  const user = await requireUser();
  const clientId = str(f, "clientId");
  return run(clientId, () => discardOnboardingClient(user, clientId));
}
