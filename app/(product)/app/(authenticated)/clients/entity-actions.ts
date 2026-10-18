"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { parseSourceRefs } from "@/lib/knowledge-sources";
import {
  addClientEntity,
  updateClientEntity,
  removeClientEntity,
  ENTITY_FIELDS,
  type ClientEntityInput,
  type EntityField,
} from "@/lib/app-domain/client-entities";
import type { KnowledgeStatus } from "@prisma/client";
import { itemExtrasFrom } from "./item-extras";

// Org brain, phase 2: the legal entities panel on the client screen
// (spec 3.3).

type FormState = { error?: string; ok?: boolean };

const STATUSES: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function text(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

function parseEntity(formData: FormData): { error?: string; value?: Omit<ClientEntityInput, "clientId"> } {
  const { refs, invalid } = parseSourceRefs(String(formData.get("sources") ?? ""));
  if (invalid.length) return { error: `מקור לא מובן: ${invalid.join(", ")}. כותבים קוד ודקה, למשל S1 08:13.` };
  const status = String(formData.get("knowledgeStatus") ?? "");
  return {
    value: {
      ...itemExtrasFrom(formData),
      name: String(formData.get("name") ?? ""),
      legalName: text(formData, "legalName"),
      registrationNumber: text(formData, "registrationNumber"),
      country: text(formData, "country"),
      currency: text(formData, "currency"),
      billingAddress: text(formData, "billingAddress"),
      parentId: text(formData, "parentId"),
      missingFields: formData
        .getAll("missingFields")
        .map(String)
        .filter((f): f is EntityField => (ENTITY_FIELDS as readonly string[]).includes(f)),
      missingToResolve: text(formData, "missingToResolve"),
      knowledgeStatus: (STATUSES as string[]).includes(status) ? (status as KnowledgeStatus) : undefined,
      toResolve: text(formData, "toResolve"),
      sources: refs,
    },
  };
}

export async function addClientEntityAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parseEntity(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  try {
    await addClientEntity(user, { ...parsed.value, clientId });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function updateClientEntityAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parseEntity(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  try {
    await updateClientEntity(user, String(formData.get("id") ?? ""), parsed.value);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function removeClientEntityAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await removeClientEntity(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
