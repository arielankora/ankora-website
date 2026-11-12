// Shared, pure formatting helpers for time-entry rows. Extracted from
// app/(product)/app/time-entries/AdminEntryRow.tsx (spec 12 admin table)
// so the on-screen table and the export route (app/api/time-entries/
// export/route.ts) render duration/source identically - no dependencies,
// no "server-only", safe to unit-test in the sandbox (see tests/unit/
// time-entry-format.test.ts and the Prisma-test limitation documented in
// tests/unit/reports.test.ts).

import { formatClockMinutes } from "@/lib/hours-format";

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "פעיל";
  return formatClockMinutes(Math.round(seconds / 60));
}

export const SOURCE_LABEL: Record<string, string> = { MANUAL: "ידני", TIMER: "טיימר" };

export function formatSource(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

/// Hadas, 23.9.2026: the same-client overlap message said only "חופף לדיווח
/// קיים", so a person looking at a list with no visible overlap had nothing
/// to go on. Name the entry: its category and its time range, in Israel
/// time. Used by both the "הזמן שלי" and the admin "דיווחי זמן" actions.
export function describeOverlapConflict(conflict: {
  startAt: Date;
  endAt: Date | null;
  category: { name: string };
  client: { name: string };
}): string {
  const fmt = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const time = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  const range = conflict.endAt
    ? `${fmt.format(conflict.startAt)} עד ${time.format(conflict.endAt)}`
    : `${fmt.format(conflict.startAt)}, טיימר שעדיין רץ`;
  return `${conflict.client.name} · ${conflict.category.name} · ${range}`;
}

/// ADR 0006: the screens' side of SOURCE_LABEL. SOURCE_LABEL and
/// formatSource stay Hebrew, because the export route and the client
/// activity prompt write them into files and prompts. A screen asks for
/// the source's key and says it in the reader's language.
export type SourceKey = "manual" | "timer";

export function sourceKey(source: string): SourceKey | null {
  if (source === "MANUAL") return "manual";
  if (source === "TIMER") return "timer";
  return null;
}

/// ADR 0006: describeOverlapConflict in the reader's language and time
/// zone. The words come from the caller (timeEntries.errors.overlap*
/// in messages/*.json), the dates from its next-intl formatter, so this
/// stays free of next-intl and testable on its own.
export type OverlapConflictWords = {
  conflict: (values: { client: string; category: string; range: string }) => string;
  range: (values: { start: string; end: string }) => string;
  rangeRunning: (values: { start: string }) => string;
};

export type DateTimeFormatterLike = {
  dateTime: (date: Date, options: { day?: "numeric"; month?: "numeric"; hour: "2-digit"; minute: "2-digit" }) => string;
};

export function describeOverlapConflictIn(
  conflict: { startAt: Date; endAt: Date | null; category: { name: string }; client: { name: string } },
  words: OverlapConflictWords,
  format: DateTimeFormatterLike
): string {
  const start = format.dateTime(conflict.startAt, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const range = conflict.endAt
    ? words.range({ start, end: format.dateTime(conflict.endAt, { hour: "2-digit", minute: "2-digit" }) })
    : words.rangeRunning({ start });
  return words.conflict({ client: conflict.client.name, category: conflict.category.name, range });
}
