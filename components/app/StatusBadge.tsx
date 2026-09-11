const TONE_CLASSES: Record<"green" | "amber" | "gray" | "red", string> = {
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  gray: "bg-navy/5 text-navy/50",
  red: "bg-red-50 text-red-700",
};

// Redesign direction A: added a leading tone dot (previously text-only
// pills) - a small, cheap way to make status scannable at a glance across
// a table without reading every label, and to add a touch of color back
// into screens that were otherwise almost entirely navy-on-cream/white
// (see the full-app UI audit that prompted this redesign). Used by every
// list screen with a status column (Clients, Users, Tasks, Hour Banks,
// Alerts, Integrations, Report Schedules, Categories, My Time, Time
// Entries, Notifications, Client Portal history) - one change here
// reaches all of them.
const DOT_CLASSES: Record<"green" | "amber" | "gray" | "red", string> = {
  green: "bg-emerald-600",
  amber: "bg-amber-600",
  gray: "bg-navy/40",
  red: "bg-red-600",
};

export function StatusBadge({ label, tone }: { label: string; tone: "green" | "amber" | "gray" | "red" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} aria-hidden="true" />
      {label}
    </span>
  );
}
