"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getActiveTimerSummaryAction } from "./active-timer-actions";
import { sameSummary, type ActiveTimerSummary } from "./active-timer-summary";
import { LiveTimerPill } from "./LiveTimerPill";

/// The running-timer state the shell shows (19.10.2026).
///
/// Until now the top bar pill and the sidebar counter ticked from a start
/// time the layout read once. App Router keeps a layout mounted across
/// navigations, so that start time was never read again: stop the timer
/// in one tab and the other tab kept counting, even on the timer screen,
/// which itself said "no running timer". Two clocks on one screen that
/// disagree is the worst thing a timer can do.
///
/// Now the layout's read is only the starting point. The state is checked
/// again with one small query when it can have changed:
/// - this tab started or stopped a timer (`announce`), and every other
///   open tab hears it through a BroadcastChannel;
/// - the tab comes back into view or gets focus;
/// - the person navigates;
/// - once a minute while the tab is visible, for a timer started from
///   Claude or from another device, which no tab hears about.
/// When a check finds a different state, the page is refreshed too, so a
/// timer screen or task screen behind a stale pill is corrected with it.

const CHANNEL = "ankora-active-timer";
const POLL_MS = 60_000;
/// Focus and visibilitychange fire together; one check is enough.
const MIN_GAP_MS = 1_500;

type Ctx = {
  summary: ActiveTimerSummary;
  /// Call after this tab started, stopped, reopened or discarded a timer.
  announce: () => void;
};

const ActiveTimerContext = createContext<Ctx>({ summary: null, announce: () => {} });

export function useActiveTimer(): Ctx {
  return useContext(ActiveTimerContext);
}

export function ActiveTimerProvider({ initial, children }: { initial: ActiveTimerSummary; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [summary, setSummary] = useState<ActiveTimerSummary>(initial);
  const current = useRef(summary);
  useEffect(() => {
    current.current = summary;
  }, [summary]);
  const lastCheck = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  // A fresh layout render (router.refresh, a server action that
  // revalidated) is newer than anything held here. Adjusted during
  // render, React's pattern for state that follows a prop.
  const initialKey = initial ? `${initial.startAt}|${initial.extraCount}` : "none";
  const [seenInitialKey, setSeenInitialKey] = useState(initialKey);
  if (seenInitialKey !== initialKey) {
    setSeenInitialKey(initialKey);
    setSummary(initial);
  }

  const check = useCallback(
    async (opts: { refreshPage: boolean; force?: boolean }) => {
      const now = Date.now();
      if (!opts.force && now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      let result: Awaited<ReturnType<typeof getActiveTimerSummaryAction>>;
      try {
        result = await getActiveTimerSummaryAction();
      } catch {
        return; // offline or a deploy in between; the next check will do
      }
      if (!result.ok || sameSummary(result.summary, current.current)) return;
      setSummary(result.summary);
      if (opts.refreshPage) router.refresh();
    },
    [router]
  );

  const announce = useCallback(() => {
    try {
      channel.current?.postMessage({ type: "changed" });
    } catch {
      // a closed channel only costs the other tabs their instant update
    }
    // This tab's screen already shows the change; only the shell catches up.
    void check({ refreshPage: false, force: true });
  }, [check]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => void check({ refreshPage: true, force: true });
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [check]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check({ refreshPage: true });
    };
    const onFocus = () => void check({ refreshPage: true });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void check({ refreshPage: true });
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [check]);

  // Navigating is the moment the screenshot of 19.10 was taken: the
  // timer screen was fresh, the pill above it was not.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    void check({ refreshPage: true });
  }, [pathname, check]);

  return <ActiveTimerContext.Provider value={{ summary, announce }}>{children}</ActiveTimerContext.Provider>;
}

/// Top bar pill, read from the shared state.
export function ShellTimerPill() {
  const { summary } = useActiveTimer();
  if (!summary) return null;
  return <LiveTimerPill startAt={summary.startAt} extraCount={summary.extraCount} />;
}

/// Mobile: the strip under the wordmark header, only while a timer runs.
export function MobileTimerStrip() {
  const { summary } = useActiveTimer();
  if (!summary) return null;
  return (
    <div className="border-t border-lineDark px-6 py-2">
      <LiveTimerPill startAt={summary.startAt} extraCount={summary.extraCount} />
    </div>
  );
}
