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
