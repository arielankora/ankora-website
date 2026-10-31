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

/// Why this person may not approve this version, or null when they may.
export function procedureApprovalBlocker(p: ProcedureApprovalInput): string | null {
  if (!approvesProceduresOf(p)) return NOT_APPROVER;
  if (p.separation && !!p.authorId && p.authorId === p.userId) return SEPARATION_REQUIRED;
  return null;
}

export function mayApproveProcedure(p: ProcedureApprovalInput): boolean {
  return procedureApprovalBlocker(p) === null;
}
