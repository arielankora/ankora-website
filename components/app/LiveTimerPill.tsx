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
 * `getActiveTimer` result the (authenticated) layout fetches once per
 * request, it doesn't duplicate the start/stop logic itself.
 */
export function LiveTimerPill({ startAt, className = "" }: { startAt: string; className?: string }) {
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
      className={`flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-cream transition-opacity hover:opacity-90 ${className}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-gold" aria-hidden="true" />
      <span className="font-jbmono text-[12.5px]" dir="ltr">
        {formatElapsed(elapsed)}
      </span>
    </Link>
  );
}
