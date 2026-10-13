"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { shekelsToMinor } from "@/lib/money";
import {
  addClientContact,
  updateClientContact,
  removeClientContact,
  addClientOrganization,
  removeClientOrganization,
} from "@/lib/app-domain/client-contacts";
import { normalizeEmail, normalizePhone, parseList } from "@/lib/contact-normalize";
import { parseSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import type { ContactRelationship, KnowledgeAudience, KnowledgeStatus } from "@prisma/client";

// Org brain, phase 2: the people and organizations panel on the client
// screen (spec 3.5).

type FormState = { error?: string; ok?: boolean };

const RELATIONSHIPS: ContactRelationship[] = ["CLIENT_STAFF", "PROVIDER", "ADVISOR", "INVESTOR", "SUPPLIER", "ANKORA"];
const STATUSES: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];
const AUDIENCES: KnowledgeAudience[] = ["ALL_STAFF", "ACCOUNT_TEAM", "RESTRICTED"];

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function pick<T extends string>(value: FormDataEntryValue | null, allowed: T[]): T | undefined {
  const v = String(value ?? "");
  return (allowed as string[]).includes(v) ? (v as T) : undefined;
}

function text(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

/// "S1 08:13, S3" from the sources field. Unreadable entries are refused
/// by name; whether the codes exist is the domain's to say.
function parseSources(formData: FormData): { error?: string; refs?: SourceRef[] } {
  const { refs, invalid } = parseSourceRefs(String(formData.get("sources") ?? ""));
  if (invalid.length) return { error: `מקור לא מובן: ${invalid.join(", ")}. כותבים קוד ודקה, למשל S1 08:13.` };
  return { refs };
}

/// Emails and phones arrive as one field each. An entry that is not an
/// address or a number is refused by name, rather than dropped quietly.
function parseContactFields(formData: FormData): { error?: string; value?: Parameters<typeof addClientContact>[1] } {
  const emails = parseList(String(formData.get("emails") ?? ""), normalizeEmail);
  if (emails.invalid.length) return { error: `כתובת מייל לא תקינה: ${emails.invalid.join(", ")}` };
  const phones = parseList(String(formData.get("phones") ?? ""), normalizePhone);
  if (phones.invalid.length) return { error: `מספר טלפון לא תקין: ${phones.invalid.join(", ")}` };
  const sources = parseSources(formData);
  if (sources.error) return { error: sources.error };
  return {
    value: {
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
      knowledgeStatus: pick(formData.get("knowledgeStatus"), STATUSES),
      toResolve: text(formData, "toResolve"),
      audience: pick(formData.get("audience"), AUDIENCES),
      doNotDisclose: text(formData, "doNotDisclose"),
      sensitivity: formData.get("sensitive") === "on" ? "SENSITIVE" : "NORMAL",
      sources: sources.refs,
    },
  };
}

export async function addClientContactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseContactFields(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  if (!parsed.value.clientId) return { error: "לקוח לא נמצא." };
  try {
    await addClientContact(user, parsed.value);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${parsed.value.clientId}`);
  return { ok: true };
}

export async function updateClientContactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = parseContactFields(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  const { clientId, organizationName: _org, ...rest } = parsed.value;
  void _org;
  try {
    await updateClientContact(user, id, rest);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientContactAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientContact(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function addClientOrganizationAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const costRaw = String(formData.get("monthlyCost") ?? "").trim();
  let monthlyCostMinor: number | null = null;
  if (costRaw) {
    monthlyCostMinor = shekelsToMinor(costRaw);
    if (monthlyCostMinor === null) return { error: "עלות חודשית לא תקינה." };
  }
  const sources = parseSources(formData);
  if (sources.error) return { error: sources.error };
  try {
    await addClientOrganization(user, {
      clientId,
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
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientOrganizationAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientOrganization(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
