import Link from "next/link";

const TABS = [
  { href: "/app/portal", key: "home", label: "בית" },
  // Portal phase 2. Second, not last: it is the only tab where the client
  // does something, and a tab people act on does not belong at the end of
  // a row they stop reading.
  { href: "/app/portal/decisions", key: "decisions", label: "החלטות" },
  { href: "/app/portal/activity", key: "activity", label: "פעילות" },
  { href: "/app/portal/hours", key: "hours", label: "שעות" },
  { href: "/app/portal/monthly", key: "month", label: "דוח חודשי" },
  { href: "/app/portal/history", key: "history", label: "היסטוריה" },
] as const;

export type PortalTabKey = (typeof TABS)[number]["key"];

// App redesign (handoff README, screen 16 "פורטל לקוח"): the prototype's
// tab bar (underline gold 2px active), styled exactly like the internal
// Reports screen's own two-tab pattern, except these are real routes
// rather than one route's `?tab=` query param.
//
// Portal phase 1 changed what the tabs are, not how they look. The
// design's four tabs were four views of the same hours; the order here is
// the order of the client's questions: what is happening (בית), what was
// done (פעילות), what it cost (שעות), and the paperwork behind it (דוח
// חודשי, היסטוריה).
//
// "פעילות שבועית" left the bar and did not leave the product: it is the
// per-day breakdown of the hours, reachable from the שעות screen, which
// is where someone who wants that number is already standing. A tab bar
// that grows with every screen stops being navigation and becomes a
// second menu.
export function PortalTabs({ active }: { active: PortalTabKey }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-lineDark">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-4 py-2.5 text-[13.5px] ${
            active === tab.key ? "border-gold font-medium text-appNavy" : "border-transparent text-appNavy/50 hover:text-appNavy"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
