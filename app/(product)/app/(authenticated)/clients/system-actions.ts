"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { shekelsToMinor } from "@/lib/money";
import { parseSourceRefs } from "@/lib/knowledge-sources";
import {
  addSystemAccess,
  updateSystemAccess,
  removeSystemAccess,
  type SystemAccessInput,
} from "@/lib/app-domain/system-map";
import type {
  BillingCycle,
  KnowledgeAudience,
  KnowledgeStatus,
  SystemAccessStatus,
  SystemPermission,
} from "@prisma/client";
import { itemExtrasFrom } from "./item-extras";

// Org brain, phase 2: the system map on the client screen (spec 3.6).

type FormState = { error?: string; ok?: boolean };

const PERMISSIONS: SystemPermission[] = [
  "NONE",
  "VIEWER",
  "USER",
  "BILLING",
  "ADMIN",
  "OWNER",
];
const STATUSES: SystemAccessStatus[] = [
  "HAS_ACCESS",
  "PENDING",
  "NO_ACCESS",
  "NOT_NEEDED",
];
const CYCLES: BillingCycle[] = ["MONTHLY", "ANNUAL", "OTHER"];
const KNOWLEDGE: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];
const AUDIENCES: KnowledgeAudience[] = [
  "ALL_STAFF",
  "ACCOUNT_TEAM",
  "RESTRICTED",
];

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError)
    return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function pick<T extends string>(
  value: FormDataEntryValue | null,
  allowed: T[],
): T | undefined {
  const v = String(value ?? "");
  return (allowed as string[]).includes(v) ? (v as T) : undefined;
}

function text(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

/// Every field, empty ones as null, so an edit can clear what it removes.
function parseSystem(formData: FormData): {
  error?: string;
  value?: Omit<SystemAccessInput, "clientId">;
} {
  const { refs, invalid } = parseSourceRefs(
    String(formData.get("sources") ?? ""),
  );
  if (invalid.length)
    return {
      error: `מקור לא מובן: ${invalid.join(", ")}. כותבים קוד ודקה, למשל S1 08:13.`,
    };
  const costRaw = String(formData.get("billingCost") ?? "").trim();
  let billingCostMinor: number | null = null;
  if (costRaw) {
    billingCostMinor = shekelsToMinor(costRaw);
    if (billingCostMinor === null) return { error: "עלות לא תקינה." };
  }
  const value: Omit<SystemAccessInput, "clientId"> = {
    systemName: String(formData.get("systemName") ?? ""),
    purpose: text(formData, "purpose"),
    entityId: text(formData, "entityId"),
    url: text(formData, "url"),
    accountUsed: text(formData, "accountUsed"),
    ourPermission: pick(formData.get("ourPermission"), PERMISSIONS),
    accessStatus: pick(formData.get("accessStatus"), STATUSES),
    blocker: text(formData, "blocker"),
    clientAdmin: text(formData, "clientAdmin"),
    credentialId: text(formData, "credentialId"),
    billingCycle:
      billingCostMinor !== null
        ? (pick(formData.get("billingCycle"), CYCLES) ?? "MONTHLY")
        : null,
    billingCostMinor,
    billingCurrency:
      billingCostMinor !== null
        ? (text(formData, "billingCurrency") ?? "USD")
        : null,
    cardLast4: text(formData, "cardLast4"),
    invoiceTo: text(formData, "invoiceTo"),
    notes: text(formData, "notes"),
    knowledgeStatus: pick(formData.get("knowledgeStatus"), KNOWLEDGE),
    toResolve: text(formData, "toResolve"),
    audience: pick(formData.get("audience"), AUDIENCES),
    doNotDisclose: text(formData, "doNotDisclose"),
    sources: refs,
    ...itemExtrasFrom(formData),
  };
  // The vault picker is shown only to people who may open the vault. A
  // form without it leaves the link as it is, rather than clearing it.
  if (!formData.has("credentialId")) delete value.credentialId;
  return { value };
}

export async function addSystemAccessAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parseSystem(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  try {
    await addSystemAccess(user, { ...parsed.value, clientId });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function updateSystemAccessAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const id = String(formData.get("id") ?? "");
  const parsed = parseSystem(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  try {
    await updateSystemAccess(user, id, parsed.value);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeSystemAccessAction(
  id: string,
  clientId: string,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeSystemAccess(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
