// 20.10.2026 (canvas "Ankora App UI Round", portal boards): three views of
// the same hours on one screen. The week by days used to be its own screen,
// reached from a link and left by a back link; as a tab it needs neither.
//
// 11.11.2026 (Hadas's portal review): "דוח חודשי" repeated the week and the
// hours, so it gave its place to "משימות". Its month picker, export and the
// account manager's summary moved to the bottom of "שעות" (#monthly-report),
// and the old addresses land there.
export const HOURS_TABS = [
  { key: "hours", label: "שעות", href: "/app/portal/hours" },
  { key: "weekly", label: "לפי ימים", href: "/app/portal/hours?view=weekly" },
  { key: "tasks", label: "משימות", href: "/app/portal/hours?view=tasks" },
];

export const MONTHLY_REPORT_ANCHOR = "monthly-report";
