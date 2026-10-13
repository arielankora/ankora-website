// The system map's words and the one rule a screen needs
// (claude/org-brain-spec-2026-10-12.md, 3.6). Pure, so a client component
// may import it.

export type SystemPermissionLike = "NONE" | "VIEWER" | "USER" | "BILLING" | "ADMIN" | "OWNER";
export type SystemAccessStatusLike = "HAS_ACCESS" | "PENDING" | "NO_ACCESS" | "NOT_NEEDED";
export type BillingCycleLike = "MONTHLY" | "ANNUAL" | "OTHER";

export const SYSTEM_PERMISSION_LABELS: Record<SystemPermissionLike, string> = {
  NONE: "אין",
  VIEWER: "צפייה",
  USER: "משתמש",
  BILLING: "חיוב",
  ADMIN: "מנהל",
  OWNER: "בעלים",
};

export const SYSTEM_ACCESS_STATUS_LABELS: Record<SystemAccessStatusLike, string> = {
  HAS_ACCESS: "יש גישה",
  PENDING: "ממתין לגישה",
  NO_ACCESS: "אין גישה",
  NOT_NEEDED: "לא נדרש",
};

export const SYSTEM_ACCESS_STATUS_TONE: Record<SystemAccessStatusLike, "green" | "amber" | "red" | "gray"> = {
  HAS_ACCESS: "green",
  PENDING: "amber",
  NO_ACCESS: "red",
  NOT_NEEDED: "gray",
};

export const BILLING_CYCLE_LABELS: Record<BillingCycleLike, string> = {
  MONTHLY: "בחודש",
  ANNUAL: "בשנה",
  OTHER: "",
};

/// The handover's gap list: systems we need and cannot reach yet. A system
/// the client keeps to themselves is not a gap.
export function isAccessGap(status: SystemAccessStatusLike): boolean {
  return status === "PENDING" || status === "NO_ACCESS";
}
