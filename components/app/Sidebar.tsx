"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search } from "lucide-react";
import { NAV_ICONS } from "./nav-icons";
import { LogoutButton } from "./LogoutButton";
import { OPEN_COMMAND_PALETTE_EVENT } from "./CommandPalette";

export type NavItem = { href: string; label: string; group?: string };

export type NavCounters = {
  /** ISO start time of the caller's own running timer, or null/undefined if none. */
  activeTimerStartAt?: string | null;
  importantDatesCount?: number;
  alertsCount?: number;
  /// Tasks phase 2: how many tasks are waiting on this person's
  /// approval. Zero prints nothing, like every other counter here.
  supervisingCount?: number;
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

  const timerCounter = useTickingCounter(counters?.activeTimerStartAt);
  let lastGroup: string | undefined;

  return (
    <aside className="hidden w-[252px] shrink-0 flex-col border-e border-white/10 bg-appNavy md:sticky md:top-0 md:flex md:h-screen">
      <div className="flex items-center gap-2 px-5 pb-3 pt-6">
        <Link href="/app" className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-light">
          Ankora
        </Link>
        <span className="rounded-full border border-[rgba(243,234,219,0.18)] px-1.5 py-0.5 text-[11px] text-cream/50">
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
          <kbd className="shrink-0 rounded border border-[rgba(243,234,219,0.18)] px-1 font-jbmono text-[10px] text-cream/40">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="ניווט ראשי">
        {items.map((item) => {
          const showHeader = item.group && item.group !== lastGroup;
          lastGroup = item.group;
          const Icon = NAV_ICONS[item.href] ?? Home;
          const active = isActive(item.href);

          const counter =
            item.href === "/app/timer" && timerCounter
              ? timerCounter
              : item.href === "/app/important-dates" && counters?.importantDatesCount
                ? String(counters.importantDatesCount)
                : item.href === "/app/supervising" && counters?.supervisingCount
                ? String(counters.supervisingCount)
                : item.href === "/app/alerts" && counters?.alertsCount
                  ? String(counters.alertsCount)
                  : null;

          return (
            <div key={item.href}>
              {showHeader && (
                <p className="mb-1 mt-4 px-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[rgba(248,244,236,0.32)] first:mt-1">
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
                {counter && <span className="shrink-0 font-jbmono text-[10.5px] text-cream/45">{counter}</span>}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <p className="truncate text-sm font-medium text-cream">{userName}</p>
        <p className="mb-3 truncate text-xs text-cream/50">{roleLabel}</p>
        <LogoutButton variant="dark" />
      </div>
    </aside>
  );
}
