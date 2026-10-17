"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { parseSourceRefs, type SourceRef } from "@/lib/knowledge-sources";
import {
  addClientFact,
  supersedeClientFact,
  confirmClientFact,
  answerClientQuestion,
  factToTask,
  closeTemporaryFact,
  removeClientFact,
  type ClientFactInput,
} from "@/lib/app-domain/client-facts";
import type { FactKind, FactTopic, KnowledgeAudience, KnowledgeStatus } from "@prisma/client";

// Org brain, phase 2: the facts panel on the client screen (spec 3.4).

type FormState = { error?: string; ok?: boolean };

const KINDS: FactKind[] = ["SCOPE_IN", "SCOPE_OUT", "PREFERENCE", "REQUIREMENT", "LOCATION", "FINANCE", "TEMPORARY", "ONE_OFF_DECISION", "QUESTION", "NOTE"];
const TOPICS: FactTopic[] = ["COMMUNICATION", "REPORTING", "DOCUMENTS", "AUTOMATION", "ADMINS", "PAYMENTS", "SUPPLIERS", "OTHER"];
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

/// A date field as UTC midnight, like every date-only value here.
function day(formData: FormData, name: string): { error?: string; value: Date | null } {
  const raw = text(formData, name);
  if (!raw) return { value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "תאריך לא תקין.", value: null };
  return { value: new Date(`${raw}T00:00:00Z`) };
}

function sources(formData: FormData): { error?: string; refs: SourceRef[] } {
  const { refs, invalid } = parseSourceRefs(String(formData.get("sources") ?? ""));
  if (invalid.length) return { error: `מקור לא מובן: ${invalid.join(", ")}. כותבים קוד ודקה, למשל S1 08:13.`, refs };
  return { refs };
}

function parseFact(formData: FormData): { error?: string; value?: Omit<ClientFactInput, "clientId"> } {
  const kind = pick(formData.get("kind"), KINDS);
  if (!kind) return { error: "צריך לבחור סוג." };
  const src = sources(formData);
  if (src.error) return { error: src.error };
  const validUntil = day(formData, "validUntil");
  const decidedAt = day(formData, "decidedAt");
  if (validUntil.error || decidedAt.error) return { error: validUntil.error ?? decidedAt.error };
  // "contact:<id>" or "org:<id>" from one picker.
  const subject = String(formData.get("subject") ?? "");
  return {
    value: {
      kind,
      body: String(formData.get("body") ?? ""),
      topic: pick(formData.get("topic"), TOPICS) ?? null,
      subjectContactId: subject.startsWith("contact:") ? subject.slice(8) : null,
      subjectOrgId: subject.startsWith("org:") ? subject.slice(4) : null,
      referTo: text(formData, "referTo"),
      validUntil: validUntil.value,
      validUntilEvent: text(formData, "validUntilEvent"),
      decidedAt: decidedAt.value,
      decidedBy: text(formData, "decidedBy"),
      assigneeId: text(formData, "assigneeId"),
      knowledgeStatus: pick(formData.get("knowledgeStatus"), STATUSES),
      toResolve: text(formData, "toResolve"),
      importance: formData.get("lowImportance") === "on" ? "LOW" : "NORMAL",
      audience: pick(formData.get("audience"), AUDIENCES),
      doNotDisclose: text(formData, "doNotDisclose"),
      sources: src.refs,
    },
  };
}

async function run(clientId: string, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

export async function addClientFactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parseFact(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => addClientFact(user, { ...parsed.value!, clientId }));
}

export async function supersedeClientFactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parseFact(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => supersedeClientFact(user, String(formData.get("id") ?? ""), parsed.value!));
}

export async function confirmClientFactAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const src = sources(formData);
  if (src.error) return { error: src.error };
  return run(clientId, () => confirmClientFact(user, String(formData.get("id") ?? ""), src.refs));
}

export async function answerClientQuestionAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const src = sources(formData);
  if (src.error) return { error: src.error };
  return run(clientId, () =>
    answerClientQuestion(user, String(formData.get("id") ?? ""), { answer: String(formData.get("answer") ?? ""), sources: src.refs })
  );
}

export async function questionToTaskAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => factToTask(user, id));
}

export async function closeTemporaryFactAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => closeTemporaryFact(user, id));
}

export async function removeClientFactAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => removeClientFact(user, id));
}
