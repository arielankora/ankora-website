// Client.subprocessorNotice (3.11.2026): whether a client's own contract
// commits Ankora to tell it, by email and ahead of time, about a new
// sub-processor. P8 step 8 emails those clients; the rest are told through
// the website. Only an explicit commitment in the client's contract counts;
// section 6 of the standard data processing addendum on the website does
// not count on its own (Ariel, 3.11.2026).
//
// Pure rules, no database: shared by the domain function, the form and the
// tests.
import type { SubprocessorNotice } from "@prisma/client";

export const SUBPROCESSOR_NOTICE_VALUES: readonly SubprocessorNotice[] = ["UNCHECKED", "COMMITTED", "NOT_COMMITTED"];

export const SUBPROCESSOR_NOTICE_LABELS: Record<SubprocessorNotice, string> = {
  UNCHECKED: "לא נבדק",
  COMMITTED: "יש התחייבות: מקבל מייל",
  NOT_COMMITTED: "אין התחייבות: מספיק עדכון באתר",
};

export const SUBPROCESSOR_NOTICE_SOURCE_REQUIRED =
  "כדי לסמן יש או אין התחייבות, צריך לכתוב את המקור: החוזה והסעיף.";

export function parseSubprocessorNotice(value: unknown): SubprocessorNotice | undefined {
  return typeof value === "string" && (SUBPROCESSOR_NOTICE_VALUES as readonly string[]).includes(value)
    ? (value as SubprocessorNotice)
    : undefined;
}

export type SubprocessorNoticeInput = {
  notice: SubprocessorNotice;
  source?: string | null;
  documentId?: string | null;
};

export type SubprocessorNoticeState = {
  subprocessorNotice: SubprocessorNotice;
  subprocessorNoticeSource: string | null;
  subprocessorNoticeDocumentId: string | null;
};

/// What to store for an answer. Back to UNCHECKED clears the source and the
/// document: an answer nobody stands behind should not keep a citation.
/// COMMITTED and NOT_COMMITTED need the source, because "who said so and
/// where" is the whole value of the field.
export function normalizeSubprocessorNotice(input: SubprocessorNoticeInput): SubprocessorNoticeState {
  if (input.notice === "UNCHECKED") {
    return { subprocessorNotice: "UNCHECKED", subprocessorNoticeSource: null, subprocessorNoticeDocumentId: null };
  }
  const source = input.source?.trim() || null;
  if (!source) throw new Error(SUBPROCESSOR_NOTICE_SOURCE_REQUIRED);
  return {
    subprocessorNotice: input.notice,
    subprocessorNoticeSource: source,
    subprocessorNoticeDocumentId: input.documentId?.trim() || null,
  };
}

export function subprocessorNoticeChanged(before: SubprocessorNoticeState, after: SubprocessorNoticeState): boolean {
  return (
    before.subprocessorNotice !== after.subprocessorNotice ||
    before.subprocessorNoticeSource !== after.subprocessorNoticeSource ||
    before.subprocessorNoticeDocumentId !== after.subprocessorNoticeDocumentId
  );
}

/// P8 step 8: who gets an email. COMMITTED by contract, and UNCHECKED to be
/// safe until someone reads the contract. Only NOT_COMMITTED is left to the
/// website.
export function getsSubprocessorEmail(notice: SubprocessorNotice): boolean {
  return notice !== "NOT_COMMITTED";
}
