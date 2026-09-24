// Shared, pure formatting helpers for time-entry rows. Extracted from
// app/(product)/app/time-entries/AdminEntryRow.tsx (spec 12 admin table)
// so the on-screen table and the export route (app/api/time-entries/
// export/route.ts) render duration/source identically - no dependencies,
// no "server-only", safe to unit-test in the sandbox (see tests/unit/
// time-entry-format.test.ts and the Prisma-test limitation documented in
// tests/unit/reports.test.ts).

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "פעיל";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
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
