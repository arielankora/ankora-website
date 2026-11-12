// Who approves a procedure (31.10.2026, Ariel: "there is no need for me;
// the client's account manager, or Hadas as a manager, can approve. They
// usually know the client better than I do"). Until now only a manager
// could, and the people who knew the client's work could not approve it.
//
// A manager approves any procedure; the client's account manager approves
// that client's procedures. A client can ask for separation (an auditor
// on SOC 2 may want it): then whoever wrote a version does not approve
// it, manager or not. Off by default. The blocking checks (R1 to R4) are
// not touched here: they hold for everyone. Pure.

export type ProcedureApprovalInput = {
  userId: string;
  /// canManageClients(role).
  isManager: boolean;
  /// Client.accountManagerId.
  accountManagerId: string | null;
  /// Client.procedureApprovalSeparation.
  separation: boolean;
  /// ProcessVersion.createdById of the version to approve; null when it
  /// is not known or not asked.
  authorId?: string | null;
};

export const NOT_APPROVER = "רק מנהל או מנהל התיק של הלקוח מאשרים נוהל.";
export const SEPARATION_REQUIRED = "ללקוח הזה נדרשת הפרדה: מי שכתב את גרסת הנוהל לא מאשר אותה. מישהו אחר מאשר.";

/// Whether this person approves procedures of this client at all.
export function approvesProceduresOf(p: Omit<ProcedureApprovalInput, "authorId" | "separation">): boolean {
  return p.isManager || (!!p.accountManagerId && p.accountManagerId === p.userId);
}

/// Why this person may not approve this version, as a code, or null when
/// they may. The code names the sentence under
/// domainErrors.procedureApproval (and approvals.items.procedure.blocker),
/// so a screen can say it in the reader's language (ADR 0006); a refusal
/// can throw it as new DomainError(`procedureApproval.${code}`, message).
export type ProcedureApprovalBlockerCode = "notApprover" | "separationRequired";

export const PROCEDURE_APPROVAL_BLOCKER_MESSAGES: Record<ProcedureApprovalBlockerCode, string> = {
  notApprover: NOT_APPROVER,
  separationRequired: SEPARATION_REQUIRED,
};

export function procedureApprovalBlockerCode(p: ProcedureApprovalInput): ProcedureApprovalBlockerCode | null {
  if (!approvesProceduresOf(p)) return "notApprover";
  if (p.separation && !!p.authorId && p.authorId === p.userId) return "separationRequired";
  return null;
}

/// Why this person may not approve this version, or null when they may.
export function procedureApprovalBlocker(p: ProcedureApprovalInput): string | null {
  const code = procedureApprovalBlockerCode(p);
  return code ? PROCEDURE_APPROVAL_BLOCKER_MESSAGES[code] : null;
}

export function mayApproveProcedure(p: ProcedureApprovalInput): boolean {
  return procedureApprovalBlocker(p) === null;
}

// One approval for a process proposal (3.11.2026, Ariel: "a manager who
// approves a process proposal approves the same thing twice"). Whoever
// approves procedures of the client approves, with the proposal, the
// procedure version it brought, when that version passes every check
// against the client's rules. With the client's separation on, the one
// who approves the proposal is the version's author, so nothing changes
// there: two approvals, by two people. Anyone else: as before.

export const COMBINED_APPROVE_LABEL = "אישור ההצעה והנוהל";

/// Whether approving a process proposal also approves its procedure,
/// for this person and this client (before the checks, which the server
/// runs at the click).
export function approvesProcedureWithProposal(p: Omit<ProcedureApprovalInput, "authorId">): boolean {
  return approvesProceduresOf(p) && !p.separation;
}

export type ProcessProposalMode = "combined" | "separation" | "draft";

export function processProposalMode(p: Omit<ProcedureApprovalInput, "authorId">): ProcessProposalMode {
  if (!approvesProceduresOf(p)) return "draft";
  return p.separation ? "separation" : "combined";
}

/// The PROCESS flag on the review card, as it reads for this person.
export function processProposalFlagMessage(mode: ProcessProposalMode): string {
  if (mode === "combined") return "באישור, גם הנוהל מאושר אם הוא עובר את הבדיקות מול כללי הלקוח, והתהליך נכנס לפעולה. אם לא, התהליך נכנס כטיוטה, והמסך אומר מה לתקן.";
  if (mode === "separation") return "באישור, התהליך נכנס כטיוטה. ללקוח הזה נדרשת הפרדה, ולכן מישהו אחר מאשר את הנוהל בנפרד.";
  return "באישור, התהליך נכנס כטיוטה. הנוהל רץ רק אחרי שמנהל מאשר אותו במסך התהליכים.";
}
