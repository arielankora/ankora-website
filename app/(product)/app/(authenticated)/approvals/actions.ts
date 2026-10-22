"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { updateTask } from "@/lib/app-domain/tasks";
import { approveException, rejectException } from "@/lib/app-domain/policy-exceptions";
import { removeClientPolicy } from "@/lib/app-domain/client-policies";
import { approveRuleDecision, confirmInternalSource } from "@/lib/app-domain/internal-client";
import { approveProcessVersion } from "@/lib/app-domain/processes";
import { approveTaskPlan } from "@/lib/app-domain/task-plans";
import { approvePortalSummary, discardPortalSummary } from "@/lib/app-domain/portal-summary";
import { approveGuide, rejectGuide } from "@/lib/app-domain/extraction-guide";
import { approveRulesTogether, runStep } from "@/lib/app-domain/process-next-steps";
import { createQuestionsTask, markQuestionsAsked } from "@/lib/app-domain/client-questions";
import type { ApprovalKind } from "@/lib/approvals";
import type { StepOp } from "@/lib/next-steps";

// The buttons on "אישורים" (lib/approvals.ts). Nothing here decides on
// its own: every decision goes through the same domain function the
// screen it came from calls, with the same checks and the same audit row,
// so approving a rule here and approving it on the client's page are one
// act with two doors.

export type DecideInput = {
  kind: ApprovalKind;
  id: string;
  version?: number;
  decision: "approve" | "reject";
  note?: string;
  clientId?: string | null;
  /// A process decision: the step to carry out (lib/next-steps.ts).
  op?: StepOp | null;
};

function friendlyError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך הרשאה להחליט על זה.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export async function decideApprovalAction(input: DecideInput): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser();
  const approve = input.decision === "approve";
  const note = (input.note ?? "").trim();
  try {
    switch (input.kind) {
      case "task":
        await updateTask(user, input.id, { status: approve ? "DONE" : "IN_PROGRESS" });
        break;
      case "exception":
        if (approve) await approveException(user, input.id, note || null);
        else await rejectException(user, input.id, note);
        break;
      case "rule":
        if (approve) await approveRuleDecision(user, input.id);
        else await removeClientPolicy(user, input.id);
        break;
      case "procedure":
        if (!approve || input.version === undefined) throw new Error("נוהל מאשרים כאן, ומתקנים אותו בתהליך עצמו.");
        await approveProcessVersion(user, input.id, input.version);
        break;
      case "plan":
        if (!approve || input.version === undefined) throw new Error("תוכנית מאשרים כאן, ומתקנים אותה במשימה עצמה.");
        await approveTaskPlan(user, input.id, input.version);
        break;
      case "summary":
        if (approve) await approvePortalSummary(user, input.id);
        else await discardPortalSummary(user, input.id);
        break;
      case "guide":
        if (approve) await approveGuide(user, input.id);
        else await rejectGuide(user, input.id, note);
        break;
      case "process":
        if (!approve || !input.op) throw new Error("אין כאן פעולה לבצע. פותחים את התהליך.");
        await runStep(user, input.op);
        break;
      case "internal":
        if (!approve || !input.clientId) throw new Error("את הפריטים של התיק הפנימי מאשרים כאן, או פותחים את התיק.");
        await confirmInternalSource(user, input.clientId, input.id);
        break;
      case "check":
        throw new Error("את החתימה בודקים עם Claude, בדף של איש הצוות.");
      case "knowledge":
        throw new Error("הצעות לתיק מאשרים אחת אחת, בלשונית ידע מהחילוץ.");
    }
  } catch (err) {
    return { error: friendlyError(err) };
  }
  // The menu's count lives in the layout.
  revalidatePath("/app", "layout");
  if (input.clientId) revalidatePath(`/app/clients/${input.clientId}`);
  return { ok: true };
}

/// "לאשר את כל הכללים של NUX": each one through approveClientPolicy.
export async function approveRulesTogetherAction(clientId: string, ids: string[]): Promise<{ error?: string; approved?: number; failed?: string[] }> {
  const user = await requireUser();
  try {
    const r = await approveRulesTogether(user, clientId, ids);
    revalidatePath("/app", "layout");
    revalidatePath(`/app/clients/${clientId}`);
    return r;
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/// The questions went to the client, by a message the person sent.
export async function markQuestionsAskedAction(clientId: string, itemIds: string[]): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser();
  try {
    await markQuestionsAsked(user, clientId, itemIds);
    revalidatePath("/app/approvals");
    return { ok: true };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/// A task to send the message, with the message in it.
export async function createQuestionsTaskAction(clientId: string, itemIds: string[], draft: string, contactName: string | null): Promise<{ error?: string; taskId?: string }> {
  const user = await requireUser();
  try {
    const r = await createQuestionsTask(user, clientId, itemIds, draft, contactName);
    revalidatePath("/app/approvals");
    revalidatePath("/app/tasks");
    return r;
  } catch (err) {
    return { error: friendlyError(err) };
  }
}
