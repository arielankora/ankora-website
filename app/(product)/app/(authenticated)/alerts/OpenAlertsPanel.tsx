"use client";
import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/app/toast/ToastProvider";
import { resolveAlertEventAction, unresolveAlertEventAction } from "./actions";

export type OpenAlertRow = {
  id: string;
  clientId: string;
  clientName: string;
  description: string;
  triggeredAgo: string;
};

// App redesign (handoff README, screen 13 "התראות"): the prototype's top
// section is a live, cross-client feed of currently-open alert cards, each
// with "סימון כטופל" (real undo) and "פתיחת בנק השעות". Two of the
// prototype's example actions are deliberately NOT here:
//   - "דחייה ב-24 שעות" (snooze) has no backing field on AlertEvent - adding
//     one needs a schema migration, out of scope for this pass.
//   - the long-running-timer card ("טיימר של X רץ מעל 8 שעות") isn't a real
//     AlertRule/AlertEvent type at all (LONG_TIMER_HOURS in reports.ts only
///    powers a badge elsewhere, not an alert) - showing it here would be
//     decorative, not functional.
// Both are still open only via lib/app-domain/alerts.ts's real
// resolveAlertEvent/unresolveAlertEvent pair.
// 9.10.2026: an empty feed says so, and says what is being watched.
// It used to render nothing, which left the screen blank until a client
// was picked and made "0 open alerts" on the home screen look like a bug.
export function OpenAlertsPanel({ alerts, emptyText }: { alerts: OpenAlertRow[]; emptyText: string }) {
  const { showToast } = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  async function resolve(alert: OpenAlertRow, isUndo = false) {
    const action = isUndo ? unresolveAlertEventAction : resolveAlertEventAction;
    const result = await action(alert.id);
    if (!result.ok) {
      showToast({ tone: "error", title: "הפעולה נכשלה", description: result.error });
      return;
    }
    setHidden((prev) => {
      const next = new Set(prev);
      if (isUndo) next.delete(alert.id);
      else next.add(alert.id);
      return next;
    });
    if (!isUndo) {
      showToast({
        tone: "success",
        title: "ההתראה סומנה כטופלה",
        description: `${alert.clientName} · ${alert.description}`,
        undo: () => resolve(alert, true),
      });
    }
  }

  const visible = alerts.filter((a) => !hidden.has(a.id));
  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-app-border bg-white px-5 py-4">
        <span className="h-2 w-2 shrink-0 rounded-full bg-app-success" aria-hidden="true" />
        <p className="text-sm text-app-text-secondary">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
      {visible.map((alert) => (
        <div key={alert.id} className="rounded-2xl border border-app-error/30 bg-white p-5">
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-xs text-app-error">דורש החלטה</span>
            <span className="text-[11px] text-app-text-tertiary">{alert.triggeredAgo}</span>
          </div>
          <p className="mt-2.5 text-sm text-app-text-primary">{alert.description}</p>
          <p className="mt-1 text-xs text-app-text-secondary">{alert.clientName}</p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolve(alert)}
              className="rounded-full bg-app-accent px-4 py-2 text-xs font-medium text-app-text-primary"
            >
              סימון כטופל
            </button>
            <Link
              href={`/app/hour-banks?clientId=${alert.clientId}`}
              className="rounded-full border border-app-border px-4 py-2 text-xs text-app-text-primary transition-colors hover:border-gold"
            >
              פתיחת בנק השעות
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
