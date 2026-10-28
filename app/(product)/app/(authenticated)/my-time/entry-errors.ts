import "server-only";
import {
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
  FutureEntryError,
  ConflictError,
} from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { describeOverlapConflict } from "@/lib/time-entry-format";

// What a manual-entry write answers with, shared by "הזמן שלי" and the
// task screen (28.10.2026). Outside actions.ts because a "use server"
// module may only export async functions.

/// Spec "אישור דיווח שעות חופף בין לקוחות שונים" (Phase 12): a cross-client
/// overlap (OverlapError.sameClient === false) is surfaced as a non-fatal,
/// confirmable warning instead of the hard `error` every other validation
/// failure returns - the employee can resubmit the SAME form data with
/// confirmOverlap set to push it through ("שמירה בכל זאת"). A same-client
/// conflict is never offered that choice; it still comes back as `error`,
/// exactly as before this feature.
export type OverlapWarning = {
  clientName: string;
  categoryName: string;
  startAt: string;
  endAt: string | null;
};

export type ManualEntryFormState = { error?: string; ok?: boolean; overlapWarning?: OverlapWarning };

export function friendlyError(err: unknown): string {
  if (err instanceof OverlapError)
    return `טווח הזמן חופף לדיווח קיים אצל אותו לקוח: ${describeOverlapConflict(err.conflicting)}.`;
  if (err instanceof ConflictError)
    return "הרשומה הזו עודכנה בינתיים על ידי מישהו אחר. יש לרענן את הדף ולנסות שוב.";
  if (err instanceof EditWindowExpiredError) return "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.";
  if (err instanceof BackdateReasonRequiredError) return "יש לציין סיבה לדיווח עבור יום קודם.";
  if (err instanceof FutureEntryError) return "לא ניתן לדווח על זמן בעתיד.";
  if (err instanceof ForbiddenError) return "אין לך הרשאה לבצע פעולה זו.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

export function overlapWarningFrom(err: OverlapError): OverlapWarning {
  return {
    clientName: err.conflicting.client.name,
    categoryName: err.conflicting.category.name,
    startAt: err.conflicting.startAt.toISOString(),
    endAt: err.conflicting.endAt ? err.conflicting.endAt.toISOString() : null,
  };
}
