"use client";
import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";

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
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function Row({ row, longTimerHours }: { row: ActiveTimerRow; longTimerHours: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startMs = new Date(row.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [row.startAt]);

  const isOverage = elapsed > longTimerHours * 3600;

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-success" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-appNavy">{row.userName}</p>
          <p className="truncate text-xs text-appNavy/50">
            {row.clientName} · {row.categoryName}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {isOverage && <StatusBadge label="חריגה" tone="red" />}
        <span className="font-jbmono text-sm text-appNavy" dir="ltr">
          {formatElapsed(elapsed)}
        </span>
      </div>
    </div>
  );
}

// App redesign (handoff README, screen 1 "בית"): "למטה: טיימרים פעילים
// כרגע - נקודה פועמת, שם עובד · לקוח · קטגוריה, זמן חי, תג 'חריגה' מעל 8
// שעות." Each row ticks its own elapsed time client-side from the
// server-provided startAt, same pattern as LiveTimerPill/TimerWidget.
export function ActiveTimersList({ rows, longTimerHours }: { rows: ActiveTimerRow[]; longTimerHours: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="divide-y divide-lineDark/70 rounded-2xl border border-lineDark bg-white">
      {rows.map((row) => (
        <Row key={row.id} row={row} longTimerHours={longTimerHours} />
      ))}
    </div>
  );
}
