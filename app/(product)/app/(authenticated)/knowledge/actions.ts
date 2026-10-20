"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { approveProposal, attachProposalToExisting, decideProposals, proposalToTask, rejectProposal } from "@/lib/app-domain/knowledge-proposals";
import { assignBatch, discardAwaiting } from "@/lib/app-domain/batch-assignment";

// Org brain, phase 2: "ממתין לאישור" (spec 5.2). Approve, edit and
// approve, reject with a reason. Nothing else writes a proposal into a
// client file.

type FormState = { error?: string; ok?: boolean };
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

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה לפעולה זו - הלקוח אינו משויך אליך.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

function done(): FormState {
  revalidatePath("/app/knowledge");
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function approveProposalAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await approveProposal(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}

/// "כבר בתיק": its sources join the item already in the file.
export async function attachProposalAction(id: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await attachProposalToExisting(user, id);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}

export async function approveEditedProposalAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
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
  try {
    await approveProposal(user, String(formData.get("id") ?? ""), edits);
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}

export async function rejectProposalAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await rejectProposal(user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? ""));
  } catch (err) {
    return { error: friendlyError(err) };
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
    return { error: friendlyError(err) };
  }
}

/// Several proposals of one batch at once (spec 5.2): each is decided as on
/// its own, and what could not be is reported back by id.
export async function approveProposalsAction(ids: string[]): Promise<BulkState> {
  const user = await requireUser();
  try {
    const r = await decideProposals(user, ids, { approve: true });
    revalidatePath("/app/knowledge");
    revalidatePath("/app", "layout");
    return { ok: r.failed.length === 0, done: r.done.length, failed: r.failed };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

export async function rejectProposalsAction(_prev: BulkState | undefined, formData: FormData): Promise<BulkState> {
  const user = await requireUser();
  try {
    const r = await decideProposals(user, formData.getAll("id").map(String), { approve: false, reason: String(formData.get("reason") ?? "") });
    revalidatePath("/app/knowledge");
    revalidatePath("/app", "layout");
    if (r.failed.length) return { error: `${r.failed.length} לא נדחו: ${r.failed[0].error}`, done: r.done.length, failed: r.failed };
    return { ok: true, done: r.done.length };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/// "ממתין לשיוך" (spec 5.1, step 3): whose meeting it was.
export async function assignBatchAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await assignBatch(user, String(formData.get("batchId") ?? ""), String(formData.get("clientId") ?? ""));
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}

export async function discardAwaitingAction(_prev: FormState | undefined, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await discardAwaiting(user, String(formData.get("batchId") ?? ""), String(formData.get("why") ?? ""));
  } catch (err) {
    return { error: friendlyError(err) };
  }
  return done();
}
