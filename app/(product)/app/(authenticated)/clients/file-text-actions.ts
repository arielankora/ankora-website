"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { badSourcesError, clientActionError as friendlyError } from "./action-errors";
import { parseSourceRefs } from "@/lib/knowledge-sources";
import { addRequestType, updateRequestType, removeRequestType, type RequestTypeInput } from "@/lib/app-domain/request-types";
import { saveNarrative, NARRATIVE_KINDS } from "@/lib/app-domain/client-narratives";
import type { KnowledgeStatus, NarrativeKind } from "@prisma/client";
import { itemExtrasFrom } from "./item-extras";

// Org brain, phase 2: request types (spec 3.7) and the file's free text
// (spec 3.3) on the client screen.

type FormState = { error?: string; ok?: boolean };

const STATUSES: KnowledgeStatus[] = ["CONFIRMED", "UNCERTAIN", "MISSING"];


function text(formData: FormData, name: string): string | null {
  return String(formData.get(name) ?? "").trim() || null;
}

async function parseRequestType(formData: FormData, selfId?: string): Promise<{ error?: string; value?: Omit<RequestTypeInput, "clientId"> }> {
  const { refs, invalid } = parseSourceRefs(String(formData.get("sources") ?? ""));
  if (invalid.length) return { error: await badSourcesError(invalid) };
  const status = String(formData.get("knowledgeStatus") ?? "");
  return {
    value: {
      ...itemExtrasFrom(formData, selfId),
      title: String(formData.get("title") ?? ""),
      fromWho: text(formData, "fromWho"),
      arrivesVia: text(formData, "arrivesVia"),
      handling: String(formData.get("handling") ?? ""),
      routeToContactIds: formData.getAll("routeTo").map(String).filter(Boolean),
      entityId: text(formData, "entityId"),
      processId: text(formData, "processId"),
      knowledgeStatus: (STATUSES as string[]).includes(status) ? (status as KnowledgeStatus) : undefined,
      toResolve: text(formData, "toResolve"),
      sources: refs,

      manualConfirm: formData.get("manualConfirm") === "1",
    },
  };
}

async function run(clientId: string, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function addRequestTypeAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = await parseRequestType(formData, user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => addRequestType(user, { ...parsed.value!, clientId }));
}

export async function updateRequestTypeAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = await parseRequestType(formData, user.id);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => updateRequestType(user, String(formData.get("id") ?? ""), parsed.value!));
}

export async function removeRequestTypeAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => removeRequestType(user, id));
}

export async function saveNarrativeAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!(NARRATIVE_KINDS as string[]).includes(kind)) return { error: (await getTranslations("clients.page.errors"))("unknownTextKind") };
  return run(clientId, () =>
    saveNarrative(user, {
      clientId,
      kind: kind as NarrativeKind,
      body: String(formData.get("body") ?? ""),
      baseVersion: Number(formData.get("baseVersion") ?? 0),
    })
  );
}
