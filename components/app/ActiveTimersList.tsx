"use client";
import { useEffect, useState } from "react";

export type ActiveTimerRow = {
  id: string;
  userName: string;
  clientName: string;
  categoryName: string;
  startAt: string; // ISO
};

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function MiniRow({ row, longTimerHours }: { row: ActiveTimerRow; longTimerHours: number }) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const startMs = new Date(row.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    // Minutes are what the card shows, so a tick every second would
    // re-render for nothing.
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [row.startAt]);

  const isOverage = elapsed !== null && elapsed > longTimerHours * 3600;

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-success" aria-hidden="true" />
        <span className="truncate text-[12.5px] text-appNavy">
          {row.userName}
          <span className="text-appNavy/50"> · {row.clientName}</span>
        </span>
      </div>
      <span
        dir="ltr"
        className={`shrink-0 font-jbmono text-[12.5px] ${isOverage ? "font-medium text-error" : "text-appNavy/70"}`}
        title={isOverage ? `רץ מעל ${longTimerHours} שעות ברצף` : undefined}
      >
        {elapsed === null ? "" : formatElapsed(elapsed)}
      </span>
    </div>
  );
}

// 9.10.2026, Ariel: the "טיימרים פעילים כרגע" card showed a number over a
// lot of empty space, and the same timers were listed again in their own
// box at the bottom of the home screen. Now the card itself names the two
// that have been running longest (the ones most likely to need a word),
// and the rest are one click away in the Active Timers report. The bottom
// box is gone.
//
// Rendered inside the card's link, so the rows are text, not links.
export function ActiveTimerMiniRows({
  rows,
  total,
  longTimerHours,
}: {
  rows: ActiveTimerRow[];
  total: number;
  longTimerHours: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2.5 border-t border-lineDark/70 pt-1.5">
      {rows.map((row) => (
        <MiniRow key={row.id} row={row} longTimerHours={longTimerHours} />
      ))}
      {total > rows.length && (
        <p className="mt-1 text-[11.5px] text-gold-dim">
          {total - rows.length === 1 ? "ועוד טיימר אחד" : `ועוד ${total - rows.length} טיימרים`} ←
        </p>
      )}
    </div>
  );
}
