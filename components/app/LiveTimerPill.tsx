"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Top bar + mobile "גלולת טיימר חי" (handoff README, App Shell section):
 * ink background, pulsing dot, JetBrains Mono time, click leads to the
 * Timer screen. Ticks client-side from the server-provided `startAt` the
 * same way TimerWidget.tsx already does, but this instance is global (it
 * shows on every screen, not just /app/timer) - it reads the same
 * `getActiveTimers` result the (authenticated) layout fetches once per
 * request, it doesn't duplicate the start/stop logic itself.
 *
 * Parallel timers (5.10.2026): one pill, never two. It counts the oldest
 * running timer and says "+1" when another is going. Two clocks side by
 * side in the top bar ask the eye to compare them; one clock and a count
 * says "there is more" and leaves the detail to the timer screen.
 */
export function LiveTimerPill({
  startAt,
  extraCount = 0,
  className = "",
}: {
  startAt: string;
  /// How many more timers are running besides this one.
  extraCount?: number;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startMs = new Date(startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startAt]);

  return (
    <Link
      href="/app/timer"
      className={`flex items-center gap-2 rounded-full bg-navy px-3 py-1.5 text-cream-warm transition-opacity hover:opacity-90 ${className}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-gold" aria-hidden="true" />
      <span className="font-jbmono text-[12.5px]" dir="ltr">
        {formatElapsed(elapsed)}
      </span>
      {extraCount > 0 && (
        <span
          className="rounded-full bg-gold/25 px-1.5 py-px font-jbmono text-[11px] text-gold-light"
          dir="ltr"
          aria-label={`ועוד ${extraCount} טיימר פעיל`}
        >
          +{extraCount}
        </span>
      )}
    </Link>
  );
}
