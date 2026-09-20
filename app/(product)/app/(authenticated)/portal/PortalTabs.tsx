import Link from "next/link";

const TABS = [
  { href: "/app/portal", key: "dash", label: "לוח בקרה" },
  { href: "/app/portal/weekly", key: "week", label: "פעילות שבועית" },
  { href: "/app/portal/monthly", key: "month", label: "דוח חודשי" },
  { href: "/app/portal/history", key: "history", label: "היסטוריה" },
] as const;

// App redesign (handoff README, screen 16 "פורטל לקוח"): "ארבע לשוניות
// במסך אחד" - the prototype's tab bar (underline gold 2px active) styled
// exactly like the internal Reports screen's own two-tab pattern
// (reports/page.tsx's inline `tabs` block), except these four tabs are
// real distinct routes rather than one route's `?tab=` query param. Kept
// as separate routes rather than folding into one client-tab component
// because: (1) each already has its own Server Component data fetch with
// no shared parent state, (2) RecipientsForm's revalidatePath targets
// "/app/portal/history" specifically, and (3) the bottom-nav "עוד" sheet
// and command palette both already link straight to "/app/portal" -
// changing the URL shape would touch working, already-shipped surfaces
// for a purely cosmetic goal the Link-based tabs below achieve anyway.
export function PortalTabs({ active }: { active: "dash" | "week" | "month" | "history" }) {
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
