// 20.10.2026 (canvas "Ankora App UI Round", portal boards): three views of
// the same hours on one screen. The week by days used to be its own screen,
// reached from a link and left by a back link; as a tab it needs neither.
export const HOURS_TABS = [
  { key: "hours", label: "שעות", href: "/app/portal/hours" },
  { key: "weekly", label: "לפי ימים", href: "/app/portal/hours?view=weekly" },
  { key: "monthly", label: "דוח חודשי", href: "/app/portal/hours?view=monthly" },
];
