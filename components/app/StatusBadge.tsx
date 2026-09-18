// App redesign (design_handoff_ankora_app_redesign/README.md, "Design
// Tokens"): migrated from raw Tailwind emerald/amber/red to the shared
// success/warning/error/neutral tokens (tailwind.config.ts) so every status
// pill in the app draws from the same palette as toasts and inline
// validation, rather than a separate ad-hoc set of greens/reds.
const TONE_CLASSES: Record<"green" | "amber" | "gray" | "red", string> = {
  green: "bg-success-soft text-success",
  amber: "bg-warning-soft text-warning",
  gray: "bg-neutral-soft text-neutral",
  red: "bg-error-soft text-error",
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
  green: "bg-success",
  amber: "bg-warning",
  gray: "bg-neutral",
  red: "bg-error",
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
