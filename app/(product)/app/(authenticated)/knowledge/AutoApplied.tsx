"use client";
import { useState } from "react";
import { autoReviewAnchor } from "@/lib/approval-links";
import { useToast } from "@/components/app/toast/ToastProvider";
import { liftAutoApplyPauseAction, markAutoReviewedAction, revertProposalAction, setAutoApplyAction } from "./actions";

// "נכנס אוטומטית" (3.11.2026, approval tiers part 2): the items that
// entered a client file on arrival and still need a look, each with "תקין"
// and "ביטול"; and, for managers, the switch for all clients and the kinds
// and clients sent back to a person after too many errors.

export type AutoReviewRow = {
  id: string;
  clientName: string;
  kindLabel: string;
  headline: string;
  /// The item in the client's file.
  itemHref: string | null;
  enteredAt: string;
  why: string;
};

export type AutoApplyPauseRow = {
  id: string;
  scope: "KIND" | "CLIENT";
  label: string;
  reason: string;
  since: string;
  decisions: number;
  approvedAsIs: number;
  lowerBoundPct: number;
  barMet: boolean;
};

export type AutoApplyControls = { enabled: boolean; firstEnabled: string | null; pauses: AutoApplyPauseRow[] };

function ReviewRow({ row }: { row: AutoReviewRow }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<"ok" | "revert" | null>(null);
  const [asking, setAsking] = useState(false);
  async function run(kind: "ok" | "revert") {
    setPending(kind);
    const r = kind === "ok" ? await markAutoReviewedAction(row.id) : await revertProposalAction(row.id);
    setPending(null);
    setAsking(false);
    if (r.error) showToast({ tone: "error", title: kind === "ok" ? "הסימון נכשל" : "הביטול נכשל", description: r.error });
    else showToast({ tone: "info", title: kind === "ok" ? "סומן תקין" : "בוטל: הפריט הוסר מהתיק", description: row.headline.slice(0, 80) });
  }
  return (
    <li id={autoReviewAnchor(row.id)} className="flex flex-wrap items-start justify-between gap-3 py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft" data-testid="auto-review-row">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-app-text-primary">{row.headline}</p>
        <p className="mt-0.5 text-xs text-app-text-tertiary">
          {row.clientName} · {row.kindLabel} · נכנס {row.enteredAt} · {row.why}
          {row.itemHref && (
            <>
              {" · "}
              <a href={row.itemHref} className="text-app-text-accent hover:underline">
                לפריט בתיק
              </a>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {asking ? (
          <>
            <span className="text-app-text-secondary">להסיר את הפריט מהתיק?</span>
            <button type="button" disabled={!!pending} onClick={() => run("revert")} className="font-medium text-app-error disabled:opacity-50" data-testid="auto-review-revert-confirm">
              {pending === "revert" ? "מסיר..." : "להסיר"}
            </button>
            <button type="button" disabled={!!pending} onClick={() => setAsking(false)} className="text-app-text-secondary">
              להשאיר
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!!pending}
              onClick={() => run("ok")}
              className="rounded-lg border border-app-border px-3 py-1 font-medium text-app-text-primary hover:border-app-accent disabled:opacity-50"
              data-testid="auto-review-ok"
            >
              {pending === "ok" ? "מסמן..." : "תקין"}
            </button>
            <button type="button" disabled={!!pending} onClick={() => setAsking(true)} className="px-2 py-1 text-app-text-accent hover:underline disabled:opacity-50" data-testid="auto-review-revert">
              ביטול
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Switch({ enabled, firstEnabled }: { enabled: boolean; firstEnabled: string | null }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  async function flip() {
    setPending(true);
    const r = await setAutoApplyAction(!enabled);
    setPending(false);
    if (r.error) showToast({ tone: "error", title: "השינוי נכשל", description: r.error });
    else showToast({ tone: "info", title: enabled ? "כניסה אוטומטית כבויה לכל הלקוחות" : "כניסה אוטומטית פועלת" });
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-app-text-secondary">
        כניסה אוטומטית לתיקים: <span className={enabled ? "font-medium text-app-success" : "font-medium text-app-warning"}>{enabled ? "פועלת" : "כבויה"}</span>
        {firstEnabled && <span className="text-app-text-tertiary"> · הופעלה לראשונה {firstEnabled}</span>}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={flip}
        className="rounded-lg border border-app-border px-3 py-1 text-xs font-medium text-app-text-primary hover:border-app-accent disabled:opacity-50"
        data-testid="auto-apply-switch"
      >
        {pending ? "שומר..." : enabled ? "לכבות לכל הלקוחות" : "להפעיל"}
      </button>
    </div>
  );
}

function PauseRow({ p }: { p: AutoApplyPauseRow }) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  async function lift() {
    setPending(true);
    const r = await liftAutoApplyPauseAction(p.id);
    setPending(false);
    if (r.error) showToast({ tone: "error", title: "ההחזרה נכשלה", description: r.error });
    else showToast({ tone: "info", title: `${p.label}: חזר לכניסה אוטומטית` });
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5" data-testid="auto-apply-pause">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-app-text-primary">
          {p.scope === "KIND" ? "סוג: " : "לקוח: "}
          {p.label}
        </p>
        <p className="mt-0.5 text-xs text-app-text-tertiary">
          {p.reason} · נעצר {p.since}
        </p>
        <p className={`mt-0.5 text-xs ${p.barMet ? "text-app-success" : "text-app-text-secondary"}`}>
          מאז: {p.decisions} החלטות של אדם אחת אחת, {p.approvedAsIs} אושרו כמו שהן, גבול תחתון {p.lowerBoundPct}%. הרף להחזרה: 30 החלטות וגבול תחתון של 85%.
        </p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={lift}
        className="rounded-lg border border-app-border px-3 py-1 text-xs font-medium text-app-text-primary hover:border-app-accent disabled:opacity-50"
        data-testid="auto-apply-lift"
      >
        {pending ? "מחזיר..." : "להחזיר לכניסה אוטומטית"}
      </button>
    </li>
  );
}

export function AutoApplied({ rows, controls }: { rows: AutoReviewRow[]; controls: AutoApplyControls | null }) {
  if (rows.length === 0 && !controls) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-app-border bg-white px-5 py-4" data-testid="auto-applied">
      <div>
        <h2 className="text-sm font-medium text-app-text-primary">נכנס אוטומטית{rows.length > 0 ? ` (${rows.length})` : ""}</h2>
        <p className="mt-1 text-xs text-app-text-secondary">
          פריטים חדשים ופשוטים, ברמת בדיקה גבוהה, נכנסים לתיק בלי לחכות. בשבועיים הראשונים, ובשבוע שאחרי הנחיות חילוץ חדשות, בודקים כאן כל אחד; אחר כך מדגם של 20%. &quot;ביטול&quot; מוריד את הפריט מהתיק ונספר כשגיאה.
        </p>
      </div>
      {controls && <Switch enabled={controls.enabled} firstEnabled={controls.firstEnabled} />}
      {controls && controls.pauses.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-app-text-primary">חזרו לאישור של אדם</h3>
          <ul className="divide-y divide-app-border">
            {controls.pauses.map((p) => (
              <PauseRow key={p.id} p={p} />
            ))}
          </ul>
        </div>
      )}
      {rows.length > 0 ? (
        <ul className="divide-y divide-app-border">
          {rows.map((r) => (
            <ReviewRow key={r.id} row={r} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-app-text-tertiary">אין כרגע פריטים שנכנסו אוטומטית ומחכים לבדיקה.</p>
      )}
    </section>
  );
}
