"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText, domainText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { approveProposal, approveWithSuggestion, attachProposalToExisting, decideProposals, mergeProposal, proposalToTask, rejectProposal, revertProposal } from "@/lib/app-domain/knowledge-proposals";
import { assignBatch, discardAwaiting } from "@/lib/app-domain/batch-assignment";
import { liftAutoApplyPause, markAutoReviewed, setAutoApply } from "@/lib/app-domain/auto-apply";
import type { ProcedureAlongside } from "@/lib/app-domain/processes";

// Org brain, phase 2: "ממתין לאישור" (spec 5.2). Approve, edit and
// approve, reject with a reason. Nothing else writes a proposal into a
// client file.

type FormState = { error?: string; ok?: boolean };
/// 3.11.2026: approving a process proposal says what became of its
/// procedure: approved with it, or why it waits.
type ApproveState = FormState & { procedure?: ProcedureAlongside | null };
type BulkState = FormState & { done?: number; failed?: { id: string; error: string }[] };

/// The fields a person may change before approving. Anything else on the
/// form is ignored rather than trusted.
const EDITABLE = new Set([
  "title",
  "handling",
  "statement",
  "interimStatement",
  "body",
  "name",
  "role",
  "context",
  "systemName",
  "purpose",
  "blocker",
  "notes",
  "accessStatus",
  "knowledgeStatus",
  "toResolve",
  "validUntil",
  "validUntilEvent",
  "decidedAt",
  "decidedBy",
  "legalName",
  "registrationNumber",
  "triggerText",
  "domain",
  "ownerName",
  "clientVisible",
  "description",
  "dueDate",
  "assigneeName",
]);

/// ADR 0006: every refusal in the reader's language. A DomainError is
/// worded from its code; anything else keeps its message, as before.
async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("knowledge.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

/// A bulk failure as the domain reported it (BulkResult), in the reader's
/// language when it came with a code.
async function failedText(f: { error: string; code?: string; values?: Record<string, string | number> }): Promise<string> {
  return f.code ? domainText(`domainErrors.${f.code}`, f.values) : f.error;
}

async function failedInReaderLanguage(failed: { id: string; error: string; code?: string; values?: Record<string, string | number> }[]) {
  return Promise.all(failed.map(async (f) => ({ id: f.id, error: await failedText(f) })));
}

function done(): FormState {
  revalidatePath("/app/approvals");
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function approveProposalAction(id: string): Promise<ApproveState> {
  const user = await requireUser();
  let procedure: ProcedureAlongside | null;
  try {
    procedure = (await approveProposal(user, id)).procedure;
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return { ...done(), procedure };
}

/// "ביטול" (3.11.2026): the new item an approved proposal created is taken
/// out of the file again. The proposal stays approved, marked reverted.
export async function revertProposalAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await revertProposal(user, id);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

/// "להשלים בנוסח המוצע": the suggested wording, worked out on the server,
/// and approval with it.
export async function approveWithSuggestionAction(id: string): Promise<ApproveState> {
  const user = await requireUser();
  let procedure: ProcedureAlongside | null;
  try {
    procedure = (await approveWithSuggestion(user, id)).procedure;
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return { ...done(), procedure };
}

/// "כבר בתיק": its sources join the item already in the file.
export async function attachProposalAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await attachProposalToExisting(user, id);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

/// "This is X already in the file": approved as a change to X.
export async function mergeProposalAction(id: string, targetId: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await mergeProposal(user, id, targetId);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

export async function approveEditedProposalAction(_prev: ApproveState | undefined, formData: FormData): Promise<ApproveState> {
  const user = await requireUser();
  const edits: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (!EDITABLE.has(key)) continue;
    const v = String(value).trim();
    // A choice left empty is no change, not a cleared value.
    if (!v && (key === "knowledgeStatus" || key === "accessStatus")) continue;
    // Spec 3.1: a yes or a no, never a string.
    if (key === "clientVisible") {
      edits.clientVisible = v === "yes";
      continue;
    }
    edits[key] = v || null;
  }
  let procedure: ProcedureAlongside | null;
  try {
    procedure = (await approveProposal(user, String(formData.get("id") ?? ""), edits)).procedure;
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return { ...done(), procedure };
}

export async function rejectProposalAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await rejectProposal(user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? ""));
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

/// Something to do, not to know: the proposal opens a task instead.
export async function proposalToTaskAction(_prev: (FormState & { taskId?: string }) | undefined, formData: FormData): Promise<FormState & { taskId?: string }> {
  const user = await requireUser();
  const due = String(formData.get("dueDate") ?? "").trim();
  const priority = String(formData.get("priority") ?? "").trim();
  try {
    const r = await proposalToTask(user, String(formData.get("id") ?? ""), {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      assignedToId: String(formData.get("assignedToId") ?? "") || null,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(due) : null,
      priority: priority === "LOW" || priority === "NORMAL" || priority === "HIGH" || priority === "URGENT" ? priority : null,
    });
    revalidatePath("/app/tasks");
    return { ...done(), taskId: r.taskId };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

/// Several proposals of one batch at once (spec 5.2): each is decided as on
/// its own, and what could not be is reported back by id.
export async function approveProposalsAction(ids: string[]): Promise<BulkState> {
  const user = await requireUser();
  try {
    const r = await decideProposals(user, ids, { approve: true });
    revalidatePath("/app/approvals");
    revalidatePath("/app", "layout");
    return { ok: r.failed.length === 0, done: r.done.length, failed: await failedInReaderLanguage(r.failed) };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

export async function rejectProposalsAction(_prev: BulkState | undefined, formData: FormData): Promise<BulkState> {
  const user = await requireUser();
  try {
    const r = await decideProposals(user, formData.getAll("id").map(String), { approve: false, reason: String(formData.get("reason") ?? "") });
    revalidatePath("/app/approvals");
    revalidatePath("/app", "layout");
    if (r.failed.length) {
      const failed = await failedInReaderLanguage(r.failed);
      const t = await getTranslations("knowledge.errors");
      return { error: t("notRejected", { count: r.failed.length, error: failed[0].error }), done: r.done.length, failed };
    }
    return { ok: true, done: r.done.length };
  } catch (err) {
    return { error: await friendlyError(err) };
  }
}

/// "ממתין לשיוך" (spec 5.1, step 3): whose meeting it was.
export async function assignBatchAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await assignBatch(user, String(formData.get("batchId") ?? ""), String(formData.get("clientId") ?? ""));
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

export async function discardAwaitingAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await discardAwaiting(user, String(formData.get("batchId") ?? ""), String(formData.get("why") ?? ""));
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

// ---------------------------------------------------------------------------
// "נכנס אוטומטית" (3.11.2026, approval tiers part 2): what entered a file
// on arrival, the switch and the pauses (lib/app-domain/auto-apply.ts).
// "ביטול" on an auto-applied item is revertProposalAction above.
// ---------------------------------------------------------------------------

/// The manager-only actions say what they need, not "the client is not
/// assigned to you". `forbidden` is what this action needs.
async function managerError(err: unknown, forbidden: "managerSwitch" | "managerLift"): Promise<string> {
  const t = await getTranslations("knowledge.errors");
  if (err instanceof ForbiddenError) return t(forbidden);
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

/// "תקין": the auto-applied item was looked at and is right.
export async function markAutoReviewedAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await markAutoReviewed(user, id);
  } catch (err) {
    return { error: await friendlyError(err) };
  }
  return done();
}

/// The switch for all clients, managers only.
export async function setAutoApplyAction(enabled: boolean): Promise<FormState> {
  const user = await requireUser();
  try {
    await setAutoApply(user, enabled);
  } catch (err) {
    return { error: await managerError(err, "managerSwitch") };
  }
  return done();
}

/// "להחזיר לכניסה אוטומטית": a manager lifts a pause.
export async function liftAutoApplyPauseAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await liftAutoApplyPause(user, id);
  } catch (err) {
    return { error: await managerError(err, "managerLift") };
  }
  return done();
}
