// 20.10.2026 (canvas "Ankora App UI Round", portal boards): three views of
// the same hours on one screen. The week by days used to be its own screen,
// reached from a link and left by a back link; as a tab it needs neither.
//
// 11.11.2026 (Hadas's portal review): "דוח חודשי" repeated the week and the
// hours, so it gave its place to "משימות". Its month picker, export and the
// account manager's summary moved to the bottom of "שעות" (#monthly-report),
// and the old addresses land there.
//
// ADR 0006: the labels are in the dictionary (portal.hours.tabs), so a
// view words its tabs with hoursTabs(t).
export const HOURS_TAB_KEYS = [
  { key: "hours", href: "/app/portal/hours" },
  { key: "weekly", href: "/app/portal/hours?view=weekly" },
  { key: "tasks", href: "/app/portal/hours?view=tasks" },
] as const;

export type HoursTabKey = (typeof HOURS_TAB_KEYS)[number]["key"];

export function hoursTabs(label: (key: HoursTabKey) => string) {
  return HOURS_TAB_KEYS.map((tab) => ({ key: tab.key, href: tab.href, label: label(tab.key) }));
}

export const MONTHLY_REPORT_ANCHOR = "monthly-report";
