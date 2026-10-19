// Two views of one subject on one screen (19.10.2026, canvas "Ankora App
// UI Round"): טיימר and הזמן שלי, דוחות and מתוזמנים, שעות and דוח
// חודשי. One row in the menu, one place to look, and the old addresses
// redirect here so no link in an email or a bookmark breaks.
//
// Plain anchors, like every navigation the app cannot afford to lose
// (claude/search-navigation-lost-2026-09-25.md). Styled as the portal's
// tab bar: an underline in the accent, no pills.
export type ViewTab = { key: string; label: string; href: string };

export function ViewTabs({ tabs, active, label }: { tabs: ViewTab[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-app-border">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`-mb-px border-b-2 px-4 py-2.5 text-[13.5px] ${
            active === tab.key
              ? "border-app-accent font-medium text-app-text-primary"
              : "border-transparent text-app-text-secondary hover:text-app-text-primary"
          }`}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/// The query of an old address, carried to the new one. Only the keys the
/// view reads, so a redirect cannot be used to smuggle anything else along.
export function carryQuery(
  searchParams: Record<string, string | string[] | undefined>,
  keys: readonly string[],
  extra: Record<string, string>,
): string {
  const out = new URLSearchParams(extra);
  for (const key of keys) {
    const value = searchParams[key];
    if (typeof value === "string" && value.length <= 200) out.set(key, value);
  }
  return out.toString();
}
