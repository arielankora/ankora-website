"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { updateTask } from "@/lib/app-domain/tasks";
import { approveException, rejectException } from "@/lib/app-domain/policy-exceptions";
import { approveClientPolicy, removeClientPolicy } from "@/lib/app-domain/client-policies";
import { approveProcessVersion } from "@/lib/app-domain/processes";
import { approveTaskPlan } from "@/lib/app-domain/task-plans";
import { approvePortalSummary, discardPortalSummary } from "@/lib/app-domain/portal-summary";
import { approveGuide, rejectGuide } from "@/lib/app-domain/extraction-guide";
import type { ApprovalKind } from "@/lib/approvals";

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
        if (approve) await approveClientPolicy(user, input.id);
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
