"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { shekelsToMinor } from "@/lib/money";
import {
  addClientContact,
  updateClientContact,
  removeClientContact,
  addClientOrganization,
  removeClientOrganization,
  updateClientOrganization,
} from "@/lib/app-domain/client-contacts";
import { normalizeEmail, normalizePhone, parseList } from "@/lib/contact-normalize";
import { parseSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import type { ContactRelationship, KnowledgeAudience, KnowledgeStatus } from "@prisma/client";
import { itemExtrasFrom } from "./item-extras";
import { knowledgeErrorT, knowledgeErrorText, type KnowledgeErrorT } from "./knowledge-errors";

// Org brain, phase 2: the people and organizations panel on the client
// screen (spec 3.5).

type FormState = { error?: string; ok?: boolean };

const RELATIONSHIPS: ContactRelationship[] = ["CLIENT_STAFF", "PROVIDER", "ADVISOR", "INVESTOR", "SUPPLIER", "ANKORA"];
const STATUSES: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];
const AUDIENCES: KnowledgeAudience[] = ["ALL_STAFF", "ACCOUNT_TEAM", "RESTRICTED"];

function pick<T extends string>(value: FormDataEntryValue | null, allowed: T[]): T | undefined {
  const v = String(value ?? "");
  return (allowed as string[]).includes(v) ? (v as T) : undefined;
}

function text(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

/// "S1 08:13, S3" from the sources field. Unreadable entries are refused
/// by name; whether the codes exist is the domain's to say.
function parseSources(formData: FormData, t: KnowledgeErrorT): { error?: string; refs?: SourceRef[] } {
  const { refs, invalid } = parseSourceRefs(String(formData.get("sources") ?? ""));
  if (invalid.length) return { error: t("badSource", { entries: invalid.join(", ") }) };
  return { refs };
}

/// Emails and phones arrive as one field each. An entry that is not an
/// address or a number is refused by name, rather than dropped quietly.
function parseContactFields(formData: FormData, t: KnowledgeErrorT, selfId?: string): { error?: string; value?: Parameters<typeof addClientContact>[1] } {
  const emails = parseList(String(formData.get("emails") ?? ""), normalizeEmail);
  if (emails.invalid.length) return { error: t("invalidEmail", { entries: emails.invalid.join(", ") }) };
  const phones = parseList(String(formData.get("phones") ?? ""), normalizePhone);
  if (phones.invalid.length) return { error: t("invalidPhone", { entries: phones.invalid.join(", ") }) };
  const sources = parseSources(formData, t);
  if (sources.error) return { error: sources.error };
  return {
    value: {
      ...itemExtrasFrom(formData, selfId),
      clientId: String(formData.get("clientId") ?? ""),
      name: text(formData, "name"),
      role: text(formData, "role"),
      emails: emails.values,
      phones: phones.values,
      organizationName: text(formData, "organizationName"),
      relationship: pick(formData.get("relationship"), RELATIONSHIPS),
      entityId: text(formData, "entityId"),
      context: text(formData, "context"),
      channelOrder: String(formData.get("channelOrder") ?? "")
        .split(/[,،\n]+/)
        .map((c) => c.trim())
        .filter(Boolean),
      isPrimary: formData.get("isPrimary") === "on",
      isDecisionMaker: formData.get("isDecisionMaker") === "on",
      clientSideAddress: text(formData, "clientSideAddress"),
      ...(formData.has("userId") ? { userId: text(formData, "userId") } : {}),
      knowledgeStatus: pick(formData.get("knowledgeStatus"), STATUSES),
      toResolve: text(formData, "toResolve"),
      audience: pick(formData.get("audience"), AUDIENCES),
      doNotDisclose: text(formData, "doNotDisclose"),
      sensitivity: formData.get("sensitive") === "on" ? "SENSITIVE" : "NORMAL",
      sources: sources.refs,

      manualConfirm: formData.get("manualConfirm") === "1",
    },
  };
}

export async function addClientContactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseContactFields(formData, await knowledgeErrorT(), user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  if (!parsed.value.clientId) return { error: (await knowledgeErrorT())("clientNotFound") };
  try {
    await addClientContact(user, parsed.value);
  } catch (err) {
    return { error: await knowledgeErrorText(err) };
  }
  revalidatePath(`/app/clients/${parsed.value.clientId}`);
  return { ok: true };
}

export async function updateClientContactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = parseContactFields(formData, await knowledgeErrorT(), user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  const { clientId, organizationName: _org, ...rest } = parsed.value;
  void _org;
  try {
    await updateClientContact(user, id, rest);
  } catch (err) {
    return { error: await knowledgeErrorText(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientContactAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientContact(user, id);
  } catch (err) {
    return { error: await knowledgeErrorText(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

function parseOrganizationFields(formData: FormData, t: KnowledgeErrorT, selfId: string): { error?: string; value?: Parameters<typeof addClientOrganization>[1] } {
  const costRaw = String(formData.get("monthlyCost") ?? "").trim();
  let monthlyCostMinor: number | null = null;
  if (costRaw) {
    monthlyCostMinor = shekelsToMinor(costRaw);
    if (monthlyCostMinor === null) return { error: t("invalidMonthlyCost") };
  }
  const sources = parseSources(formData, t);
  if (sources.error) return { error: sources.error };
  return {
    value: {
      ...itemExtrasFrom(formData, selfId),
      clientId: String(formData.get("clientId") ?? ""),
      name: String(formData.get("name") ?? ""),
      domains: String(formData.get("domains") ?? "")
        .split(/[,\s]+/)
        .filter(Boolean),
      role: text(formData, "role"),
      relationship: pick(formData.get("relationship"), RELATIONSHIPS),
      monthlyCostMinor,
      currency: monthlyCostMinor !== null ? text(formData, "currency") ?? "ILS" : null,
      notes: text(formData, "notes"),
      knowledgeStatus: pick(formData.get("knowledgeStatus"), STATUSES),
      toResolve: text(formData, "toResolve"),
      sources: sources.refs,

      manualConfirm: formData.get("manualConfirm") === "1",
    },
  };
}

export async function addClientOrganizationAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseOrganizationFields(formData, await knowledgeErrorT(), user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  try {
    await addClientOrganization(user, parsed.value);
  } catch (err) {
    return { error: await knowledgeErrorText(err) };
  }
  revalidatePath(`/app/clients/${parsed.value.clientId}`);
  return { ok: true };
}

export async function updateClientOrganizationAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = parseOrganizationFields(formData, await knowledgeErrorT(), user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  const { clientId, name: _name, ...rest } = parsed.value;
  void _name;
  try {
    await updateClientOrganization(user, id, rest);
  } catch (err) {
    return { error: await knowledgeErrorText(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientOrganizationAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientOrganization(user, id);
  } catch (err) {
    return { error: await knowledgeErrorText(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
