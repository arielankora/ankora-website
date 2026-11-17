// Claude usage measurement (17.11.2026): the prompts Ankora builds for a
// person to paste into Claude. Each copy is recorded with its length only
// (ClaudePromptCopy), so the report can say which prompt costs the most
// and how often it is used. Pure, so client components and tests share it.

export const PROMPT_KINDS = [
  /// "קדם עם קלוד" on open work (tasks, important dates).
  "advance_plan",
  /// "סיכום ולקחים עם קלוד" on a closed task.
  "advance_lessons",
  /// "חלץ ידע עם קלוד" on a client's file.
  "extract",
  /// The English version of a procedure document.
  "translation",
  /// The client activity summary on the reports screen.
  "client_activity",
] as const;

export type PromptKind = (typeof PROMPT_KINDS)[number];

export function isPromptKind(value: unknown): value is PromptKind {
  return typeof value === "string" && (PROMPT_KINDS as readonly string[]).includes(value);
}

/// Longer than any prompt the app builds by a wide margin; a value past it
/// is not a real copy and is clamped rather than trusted.
export const MAX_PROMPT_CHARS = 2_000_000;
