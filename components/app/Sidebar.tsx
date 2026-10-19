"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronUp, Home, Search } from "lucide-react";
import { NAV_ICONS } from "./nav-icons";
import { LogoutButton } from "./LogoutButton";
import { OPEN_COMMAND_PALETTE_EVENT } from "./CommandPalette";
import { useActiveTimer } from "./ActiveTimerProvider";

export type NavItem = { href: string; label: string; group?: string };

/// Items in this group live in the menu under the person's name, not in the
/// list (19.10.2026). BottomNav and the command palette still list them.
export const ACCOUNT_GROUP = "חשבון";

export type NavCounters = {
  importantDatesCount?: number;
  alertsCount?: number;
  /// Tasks phase 2: how many tasks are waiting on this person's
  /// approval. Zero prints nothing, like every other counter here.
  supervisingCount?: number;
  /// Org brain: proposals to client files waiting for a person.
  knowledgeCount?: number;
};

/** Ticks a "H:MM" counter from an ISO start time - mirrors LiveTimerPill's own tick, kept separate since this one renders a shorter format for the nav row. */
function useTickingCounter(startAt: string | null | undefined): string | null {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startAt) return;
    const startMs = new Date(startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startAt]);
  if (!startAt) return null;
  return formatCounterTime(elapsed);
}

function formatCounterTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// App redesign (handoff README, App Shell section, "סייד־בר"): 252px,
// sticky full-height navy sidebar with an OPS badge, a search/command
// button, grouped nav with counter tags, and a footer identity block.
// Redesign direction A's grouped-by-`group` structure (see nav-icons.ts and
// AppShell.tsx's navItemsFor) is unchanged - only sizing, the OPS badge,
// the search button, and per-item counters are new here.
export function Sidebar({
  items,
  userName,
  roleLabel,
  counters,
}: {
  items: NavItem[];
  userName: string;
  roleLabel: string;
  counters?: NavCounters;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
  }

  function openCommandPalette() {
    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
  }

  // The running timer comes from the shared, live state rather than a
  // prop the layout read once, so it stops when the timer stops in any tab.
  const { summary: activeTimer } = useActiveTimer();
  const timerCounter = useTickingCounter(activeTimer?.startAt);
  let lastGroup: string | undefined;

  return (
    <aside className="hidden w-[252px] shrink-0 flex-col border-e border-white/10 bg-app-surface-nav md:sticky md:top-0 md:flex md:h-screen">
      <div className="flex items-center gap-2 px-5 pb-3 pt-6">
        <Link href="/app" className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-light">
          Ankora
        </Link>
        <span className="rounded-full border border-[rgba(243,234,219,0.18)] px-1.5 py-0.5 text-[11px] text-[#B4B8BC]">
          OPS
        </span>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2 rounded-[10px] bg-[rgba(248,244,236,0.06)] px-2.5 py-2 text-start text-[13px] text-cream/60 transition-colors hover:bg-[rgba(248,244,236,0.1)]"
        >
          <Search size={15} strokeWidth={1.75} className="shrink-0" />
          <span className="flex-1 truncate">חיפוש או פעולה</span>
          <kbd className="shrink-0 rounded border border-[rgba(243,234,219,0.18)] px-1 font-jbmono text-[10px] text-[#B4B8BC]">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="ניווט ראשי">
        {items.filter((item) => item.group !== ACCOUNT_GROUP).map((item) => {
          const showHeader = item.group && item.group !== lastGroup;
          lastGroup = item.group;
          const Icon = NAV_ICONS[item.href] ?? Home;
          const active = isActive(item.href);

          const counter =
            item.href === "/app/timer" && timerCounter
              ? timerCounter
              : item.href === "/app/important-dates" && counters?.importantDatesCount
                ? String(counters.importantDatesCount)
                : item.href === "/app/tasks" && counters?.supervisingCount
                ? String(counters.supervisingCount)
                : item.href === "/app/knowledge" && counters?.knowledgeCount
                ? String(counters.knowledgeCount)
                : item.href === "/app/alerts" && counters?.alertsCount
                  ? String(counters.alertsCount)
                  : null;

          return (
            <div key={item.href}>
              {showHeader && (
                <p className="mb-1 mt-4 px-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#8F98A3] first:mt-1">
                  {item.group}
                </p>
              )}
              <Link
                href={item.href}
                // Every screen behind this nav is dynamic, signed-in and
                // database-backed, so Next cannot prefetch anything of a
                // page here: it fetches the loading shell, once per link,
                // on every view of every screen. Fourteen requests, each
                // one a session check and a render, to save nothing.
                //
                // They are also implicated in the write fault the browser
                // suite has been chasing: every abort burst it has
                // recorded is this whole nav re-prefetching at the moment
                // a form is submitted, and the submitted write cancelled
                // along with it. Whether that is cause or company, a
                // dozen concurrent requests nobody asked for is not what
                // should be happening while somebody saves a form.
                prefetch={false}
                className={`flex items-center gap-2.5 rounded-[10px] border-s-2 px-2.5 py-[9px] text-[13px] transition-colors ${
                  active
                    ? "border-gold bg-gold/[0.18] font-medium text-[#F8F4EC]"
                    : "border-transparent text-[rgba(243,234,219,0.68)] hover:bg-[rgba(248,244,236,0.06)] hover:text-cream"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {counter && <span className="shrink-0 font-jbmono text-[10.5px] text-[#B4B8BC]">{counter}</span>}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* 19.10.2026: the account menu opens from the name. A native
          <details>, so it works before hydration and needs no state; the
          links are plain anchors like the rest of the navigation. It opens
          upward, since it sits at the bottom of the screen. */}
      <details className="group relative border-t border-white/10">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-4 hover:bg-[rgba(248,244,236,0.06)] [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-light text-[13px] font-medium text-app-text-primary">
            {/* The first letter, Hebrew or Latin: "[DEMO] ..." starts with a bracket. */}
            {userName.replace(/^[^A-Za-z0-9\u0590-\u05FF]+/, "").charAt(0)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-cream">{userName}</span>
            <span className="block truncate text-xs text-cream/60">{roleLabel}</span>
          </span>
          <ChevronUp size={14} aria-hidden="true" className="shrink-0 text-cream/60 transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute inset-x-3 bottom-full mb-2 rounded-xl border border-app-border bg-white p-1.5 shadow-lg">
          {items
            .filter((item) => item.group === ACCOUNT_GROUP)
            .map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-2 text-[13px] text-app-text-primary hover:bg-app-surface-sunken"
              >
                {item.label}
              </a>
            ))}
          <div className="mt-1 border-t border-app-border px-1.5 pt-1.5">
            <LogoutButton />
          </div>
        </div>
      </details>
    </aside>
  );
}
