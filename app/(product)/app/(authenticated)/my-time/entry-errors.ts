import "server-only";
import {
  OverlapError,
  EditWindowExpiredError,
  BackdateReasonRequiredError,
  FutureEntryError,
  ConflictError,
} from "@/lib/app-domain/time-entries";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  ClosedBankError,
  OVERRIDE_WARNING_KEY,
  STOPPED_ACROSS_CLOSURE_KEY,
  closedBankValues,
  type ClosedBankHit,
} from "@/lib/app-domain/closed-bank-guard";
import { getFormatter, getTranslations } from "next-intl/server";
import { domainErrorText, domainText } from "@/lib/i18n/domain-errors";

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

/// 3.11.2026, "לא רושמים בחבילה סגורה": a write that lands in a closed
/// hour bank comes back as this, not as `error`, so the screen can offer
/// what the rule allows: recording it in the open bank, or, for a manager,
/// changing the closed bank anyway after "are you sure" and with a reason.
export type ClosedBankNoticeState = {
  message: string;
  canMoveToOpen: boolean;
  canOverride: boolean;
  overrideWarning: string;
};

export type ManualEntryFormState = {
  error?: string;
  ok?: boolean;
  overlapWarning?: OverlapWarning;
  closedBank?: ClosedBankNoticeState;
};

/// ADR 0006: async, because both sentences are in the reader's language.
export async function closedBankNoticeFrom(err: ClosedBankError): Promise<ClosedBankNoticeState> {
  return {
    message: (await domainErrorText(err)) ?? err.message,
    canMoveToOpen: err.canMoveToOpen,
    canOverride: err.canOverride,
    overrideWarning: await domainText(OVERRIDE_WARNING_KEY),
  };
}

/// After a stop that crossed a closure (timer and task screens): the
/// question the person is asked, in their language. The Hebrew original,
/// stoppedAcrossClosureMessage, stays for MCP.
export async function stoppedAcrossClosureText(hit: ClosedBankHit): Promise<string> {
  return domainText(STOPPED_ACROSS_CLOSURE_KEY, closedBankValues(hit));
}

/// The two answers a form can send back after the notice.
export function closedBankOptionsFrom(formData: FormData): {
  intoOpenBank: boolean;
  closedBankOverride: { reason: string } | null;
} {
  const reason = String(formData.get("closedBankOverrideReason") || "").trim();
  return {
    intoOpenBank: formData.get("intoOpenBank") === "true",
    closedBankOverride: reason ? { reason } : null,
  };
}

/// ADR 0006: async, because the sentence is in the reader's language.
/// Callers outside this folder (tasks/[id]/actions.ts) must await it.
export async function friendlyError(err: unknown): Promise<string> {
  const t = await getTranslations("timeEntries.errors");
  if (err instanceof OverlapError)
    return t("overlapSameClient", { conflict: await describeConflict(err.conflicting) });
  if (err instanceof ConflictError) return t("conflict");
  if (err instanceof EditWindowExpiredError) return t("editWindowExpired");
  if (err instanceof BackdateReasonRequiredError) return t("backdateReasonRequired");
  if (err instanceof FutureEntryError) return t("futureEntry");
  if (err instanceof ForbiddenError) return t("forbidden");
  const text = await domainErrorText(err);
  if (text) return text;
  if (err instanceof Error) return err.message;
  return t("generic");
}

/// The entry an overlap ran into, named by its client, category and time
/// range (Hadas, 23.9.2026), in the reader's language and time zone. The
/// same wording as lib/time-entry-format.ts's describeOverlapConflict,
/// which the admin screen and its tests still use.
async function describeConflict(conflict: OverlapError["conflicting"]): Promise<string> {
  const t = await getTranslations("timeEntries.errors");
  const format = await getFormatter();
  const start = format.dateTime(conflict.startAt, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const range = conflict.endAt
    ? t("overlapRange", { start, end: format.dateTime(conflict.endAt, { hour: "2-digit", minute: "2-digit" }) })
    : t("overlapRangeRunning", { start });
  return t("overlapConflict", { client: conflict.client.name, category: conflict.category.name, range });
}

export function overlapWarningFrom(err: OverlapError): OverlapWarning {
  return {
    clientName: err.conflicting.client.name,
    categoryName: err.conflicting.category.name,
    startAt: err.conflicting.startAt.toISOString(),
    endAt: err.conflicting.endAt ? err.conflicting.endAt.toISOString() : null,
  };
}
