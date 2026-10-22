"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  addClientSource,
  removeClientSource,
  addClientDomain,
  removeClientDomain,
  setClientSourceAnchors,
} from "@/lib/app-domain/client-sources";
import { confirmSourceWithClient } from "@/lib/app-domain/source-confirmation";
import type { ClientDomainKind, SourceKind, SourceRestriction, SourceWeight } from "@prisma/client";

// Org brain, phase 2: the source register and the domains on the client
// screen (spec 3.2 and 3.5).

type FormState = { error?: string; ok?: boolean };

const KINDS: SourceKind[] = ["TRANSCRIPT", "CLIENT_DOCUMENT", "TASK", "PERSON", "ANKORA_DOCUMENT", "EMAIL"];
const WEIGHTS: SourceWeight[] = ["PRIMARY", "SECONDARY"];
const RESTRICTIONS: SourceRestriction[] = ["NONE", "TOPICS_ONLY"];
const DOMAIN_KINDS: ClientDomainKind[] = ["CLIENT", "PARTNER"];

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function pick<T extends string>(value: FormDataEntryValue | null, allowed: T[]): T | undefined {
  const v = String(value ?? "");
  return (allowed as string[]).includes(v) ? (v as T) : undefined;
}

function list(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,،\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function addClientSourceAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const kind = pick(formData.get("kind"), KINDS);
  if (!kind) return { error: "צריך לבחור סוג מקור." };
  const dateRaw = String(formData.get("occurredAt") ?? "").trim();
  let occurredAt: Date | null = null;
  if (dateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "תאריך לא תקין." };
    occurredAt = new Date(`${dateRaw}T00:00:00Z`);
  }
  try {
    await addClientSource(user, {
      clientId,
      kind,
      title: String(formData.get("title") ?? ""),
      weight: pick(formData.get("weight"), WEIGHTS),
      occurredAt,
      participants: list(formData.get("participants")),
      externalIds: list(formData.get("externalIds")),
      restriction: formData.get("topicsOnly") === "on" ? "TOPICS_ONLY" : pick(formData.get("restriction"), RESTRICTIONS),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientSourceAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientSource(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function addClientDomainAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const kind = pick(formData.get("kind"), DOMAIN_KINDS);
  if (!kind) return { error: "צריך לבחור של מי הדומיין." };
  try {
    await addClientDomain(user, {
      clientId,
      domain: String(formData.get("domain") ?? ""),
      kind,
      organizationName: String(formData.get("organizationName") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientDomainAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientDomain(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/// The source anchors beside the domains (22.10.2026).
export async function setClientSourceAnchorsAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  try {
    await setClientSourceAnchors(user, {
      clientId,
      keywords: list(formData.get("keywords")),
      driveFolder: String(formData.get("driveFolder") ?? "").trim() || null,
      conversationsDoc: String(formData.get("conversationsDoc") ?? "").trim() || null,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/// "אושר מול הלקוח": every item uncertain only because this source is
/// Ankora's, confirmed in one step (21.10.2026).
export async function confirmSourceWithClientAction(_prev: (FormState & { confirmed?: number }) | undefined, formData: FormData): Promise<FormState & { confirmed?: number }> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  try {
    const r = await confirmSourceWithClient(user, clientId, String(formData.get("code") ?? ""), String(formData.get("note") ?? ""));
    revalidatePath(`/app/clients/${clientId}`);
    revalidatePath("/app/approvals");
    return { ok: true, confirmed: r.confirmed };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}
