"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { parseSourceRefs } from "@/lib/knowledge-sources";
import { POLICY_KINDS } from "@/lib/client-policies";
import {
  addClientPolicy,
  approveClientPolicy,
  removeClientPolicy,
  retireClientPolicy,
  updateClientPolicy,
  type ClientPolicyInput,
} from "@/lib/app-domain/client-policies";
import { approveException, rejectException, requestException, withdrawException } from "@/lib/app-domain/policy-exceptions";
import { setClientRuleApprovers } from "@/lib/app-domain/rule-approvals";
import type { KnowledgeStatus, PolicyKind } from "@prisma/client";

// Org brain, phase 3: the client's own rules on the client screen
// (claude/org-brain-spec-2026-10-12.md, 3.11).

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

function parsePolicy(formData: FormData): { error?: string; value?: Omit<ClientPolicyInput, "clientId"> } {
  const { refs, invalid } = parseSourceRefs(String(formData.get("sources") ?? ""));
  if (invalid.length) return { error: `מקור לא מובן: ${invalid.join(", ")}. כותבים קוד ודקה, למשל S1 08:13.` };
  const kind = String(formData.get("kind") ?? "");
  if (!(POLICY_KINDS as string[]).includes(kind)) return { error: "צריך לבחור את סוג הכלל." };
  const status = String(formData.get("knowledgeStatus") ?? "");
  return {
    value: {
      kind: kind as PolicyKind,
      title: String(formData.get("title") ?? ""),
      statement: String(formData.get("statement") ?? ""),
      rationale: text(formData, "rationale"),
      interimStatement: text(formData, "interimStatement"),
      knowledgeStatus: (STATUSES as string[]).includes(status) ? (status as KnowledgeStatus) : undefined,
      toResolve: text(formData, "toResolve"),
      sources: refs,
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

export async function addPolicyAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parsePolicy(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => addClientPolicy(user, { ...parsed.value!, clientId }));
}

export async function updatePolicyAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = parsePolicy(formData);
  if (parsed.error || !parsed.value) return { error: parsed.error };
  return run(clientId, () => updateClientPolicy(user, String(formData.get("id") ?? ""), parsed.value!));
}

export async function retirePolicyAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  return run(clientId, () => retireClientPolicy(user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? "")));
}

export async function approvePolicyAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => approveClientPolicy(user, id));
}

export async function removePolicyAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => removeClientPolicy(user, id));
}

// ---------------------------------------------------------------------------
// Exceptions and approvers (spec 3.11, decision 5)
// ---------------------------------------------------------------------------

export async function requestExceptionAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  const until = String(formData.get("validUntil") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: "חריגה צריכה תאריך סיום." };
  return run(clientId, () =>
    requestException(user, {
      policyId: String(formData.get("policyId") ?? ""),
      what: String(formData.get("what") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      validUntil: new Date(`${until}T00:00:00Z`),
    })
  );
}

export async function approveExceptionAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => approveException(user, id));
}

export async function rejectExceptionAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  return run(clientId, () => rejectException(user, String(formData.get("id") ?? ""), String(formData.get("note") ?? "")));
}

export async function withdrawExceptionAction(id: string, clientId: string): Promise<FormState> {
  const user = await requireUser();
  return run(clientId, () => withdrawException(user, id));
}

export async function setRuleApproversAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const clientId = String(formData.get("clientId") ?? "");
  return run(clientId, () => setClientRuleApprovers(user, clientId, formData.getAll("approver").map(String)));
}
