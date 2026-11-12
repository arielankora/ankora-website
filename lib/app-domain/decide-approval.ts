import "server-only";
import type { User } from "@prisma/client";
import { updateTask } from "@/lib/app-domain/tasks";
import { approveException, rejectException } from "@/lib/app-domain/policy-exceptions";
import { removeClientPolicy } from "@/lib/app-domain/client-policies";
import { approveRuleDecision, confirmInternalSource } from "@/lib/app-domain/internal-client";
import { approveProcessVersion } from "@/lib/app-domain/processes";
import { approveTaskPlan } from "@/lib/app-domain/task-plans";
import { approvePortalSummary, discardPortalSummary } from "@/lib/app-domain/portal-summary";
import { approveGuide, rejectGuide } from "@/lib/app-domain/extraction-guide";
import { runStep } from "@/lib/app-domain/process-next-steps";
import type { ApprovalKind } from "@/lib/approvals";
import { DomainError } from "@/lib/domain-error";
import type { StepOp } from "@/lib/next-steps";

// One decision on a row of "אישורים" (lib/approvals.ts), with three doors:
// the button on the screen, the button on the screen the item came from,
// and Claude (decide_approval, 2.11.2026). Nothing here decides on its
// own: each kind goes through the same domain function its own screen
// calls, with the same checks and the same audit row.

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

export async function decideApproval(user: User, input: DecideInput): Promise<void> {
  const approve = input.decision === "approve";
  const note = (input.note ?? "").trim();
  switch (input.kind) {
    case "task":
      await updateTask(user, input.id, { status: approve ? "DONE" : "IN_PROGRESS" });
      return;
    case "exception":
      if (approve) await approveException(user, input.id, note || null);
      else await rejectException(user, input.id, note);
      return;
    case "rule":
      if (approve) await approveRuleDecision(user, input.id);
      else await removeClientPolicy(user, input.id);
      return;
    case "procedure":
      if (!approve || input.version === undefined) throw new DomainError("decideApproval.procedureHere", "נוהל מאשרים כאן, ומתקנים אותו בתהליך עצמו.");
      await approveProcessVersion(user, input.id, input.version);
      return;
    case "plan":
      if (!approve || input.version === undefined) throw new DomainError("decideApproval.planHere", "תוכנית מאשרים כאן, ומתקנים אותה במשימה עצמה.");
      await approveTaskPlan(user, input.id, input.version);
      return;
    case "summary":
      if (approve) await approvePortalSummary(user, input.id);
      else await discardPortalSummary(user, input.id);
      return;
    case "guide":
      if (approve) await approveGuide(user, input.id);
      else await rejectGuide(user, input.id, note);
      return;
    case "process":
      if (!approve || !input.op) throw new DomainError("decideApproval.processNoOp", "אין כאן פעולה לבצע. פותחים את התהליך.");
      await runStep(user, input.op);
      return;
    case "internal":
      if (!approve || !input.clientId) throw new DomainError("decideApproval.internalHere", "את הפריטים של התיק הפנימי מאשרים כאן, או פותחים את התיק.");
      await confirmInternalSource(user, input.clientId, input.id);
      return;
    case "check":
      throw new DomainError("decideApproval.checkWithClaude", "את החתימה בודקים עם Claude, בדף של איש הצוות.");
    case "knowledge":
      throw new DomainError("decideApproval.knowledgeOneByOne", "הצעות לתיק מאשרים אחת אחת, בלשונית ידע מהחילוץ.");
  }
}
