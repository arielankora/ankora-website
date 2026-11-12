import type { ClientDocumentKind, PortalDigest, SupplierExperience, TaskBlocker } from "@prisma/client";

// Portal phase 3. The Hebrew for three enums, in a module with no
// "server-only" at the top.
//
// Not a style choice: the client's file has forms in it, forms are client
// components, and a client component that imports a server-only module
// fails the build. The labels are the only part of that domain a browser
// needs, so they live where a browser can reach them and the logic stays
// where it belongs.

export const DIGEST_LABELS: Record<PortalDigest, string> = {
  EVERY_DECISION: "כל החלטה, ברגע שהיא נפתחת",
  WEEKLY: "סיכום שבועי",
  MONTHLY: "רק הסיכום החודשי",
};

export const DOCUMENT_KIND_LABELS: Record<ClientDocumentKind, string> = {
  POLICY: "פוליסה",
  PROCEDURE: "נוהל",
  CERTIFICATE: "אישור",
  CONTRACT: "חוזה",
  INVOICE: "חשבונית",
  OTHER: "מסמך",
};

export const SUPPLIER_EXPERIENCE_LABELS: Record<SupplierExperience, string> = {
  GOOD: "מומלץ",
  OK: "בסדר",
  AVOID: "לא נשתמש שוב",
};

/// The one sentence at the top of the portal's home screen.
///
/// Moved here from the screen so it can be tested, and rewritten because
/// it was lying. The old version counted decisions and waiting promises
/// into one number and then described that number as decisions: a client
/// with no decisions and one waiting promise was told "דבר אחד מחכה
/// להחלטה שלך", clicked through to the decisions tab, and was told there
/// was nothing there. Found on a real client in production.
///
/// The two are genuinely different things and the client already reads
/// them differently. A decision has options, a price and a recommendation,
/// and it is answered on its own screen. A promise waiting on the client
/// is work in flight that needs something from them, and it carries the
/// stage label "מחכה לך" everywhere else in the portal.
///
/// So: the word "החלטה" appears only when there is a decision, and when
/// both exist the sentence counts them together without naming either.
export function portalHeadline(decisions: number, waiting: number, inProgress: number): string {
  const { kind, count } = portalHeadlineKey(decisions, waiting, inProgress);
  switch (kind) {
    case "decisions":
      return count === 1 ? "החלטה אחת מחכה לך." : `${count} החלטות מחכות לך.`;
    case "needsYou":
      return count === 1 ? "דבר אחד מחכה לך." : `${count} דברים מחכים לך.`;
    case "allClear":
      return "הכל מטופל. אין כרגע דבר שדורש פעולה מצדך.";
    case "inProgress":
      return count === 1 ? "הבטחה אחת בטיפול. אין דבר שמחכה לך." : `${count} הבטחות בטיפול. אין דבר שמחכה לך.`;
  }
}

/// ADR 0006: the same rule as portalHeadline, as a kind and a count, so
/// the portal's home screen can word it in the reader's language
/// (portal.home.headline in messages/*.json). portalHeadline words it in
/// Hebrew from the same answer, so the two cannot drift apart.
export type PortalHeadlineKind = "decisions" | "needsYou" | "allClear" | "inProgress";

export function portalHeadlineKey(
  decisions: number,
  waiting: number,
  inProgress: number,
): { kind: PortalHeadlineKind; count: number } {
  if (decisions > 0 && waiting === 0) return { kind: "decisions", count: decisions };
  const needsYou = decisions + waiting;
  if (needsYou > 0) return { kind: "needsYou", count: needsYou };
  if (inProgress === 0) return { kind: "allClear", count: 0 };
  return { kind: "inProgress", count: inProgress };
}

/// Tasks phase 5. Who we are waiting on, as a person would say it.
///
/// Here rather than beside the domain for the reason this whole module
/// exists: three screens that render a block are client components, and
/// the domain is server-only.
export const TASK_BLOCKER_LABELS: Record<TaskBlocker, string> = {
  CLIENT: "ממתין ללקוח",
  SUPPLIER: "ממתין לספק",
  INTERNAL: "ממתין לגורם פנימי",
  OTHER: "ממתין",
};

/// "ממתין ללקוח, 6 ימים".
///
/// The age is not decoration. A block with no age is a place to park
/// work, and the whole argument for storing `blockedSince` rather than a
/// boolean is that somebody reading a list can see which wait has gone
/// on too long without opening anything.
///
/// Days rather than a date, because the question is "how long", and
/// whole days rather than hours because a wait measured in hours is not
/// yet a wait anybody needs to act on.
export function waitingTitle(on: TaskBlocker, since: string | null): string {
  const label = TASK_BLOCKER_LABELS[on];
  if (!since) return label;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  if (days < 1) return `${label}, מהיום`;
  if (days === 1) return `${label}, מאתמול`;
  return `${label}, ${days} ימים`;
}
