"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { withFrom } from "@/lib/list-back";
import { useToast } from "@/components/app/toast/ToastProvider";
import { archiveClientAction, restoreClientAction } from "./actions";
import { startPortalPreviewAction } from "../portal/actions";
import type { ClientStatus } from "@prisma/client";

/// One bar of a client's last cycles: hours used and the size of the
/// cycle, each as a share of the tallest figure in that client's history.
export type HistoryBar = {
  label: string;
  usedShare: number;
  sizeShare: number | null;
  over: boolean;
  current: boolean;
  title: string;
};

export type ClientCard = {
  id: string;
  name: string;
  status: ClientStatus;
  employeeCount: number;
  openTasks: number;
  approvals: number;
  bank: {
    kindLabel: string;
    /// Decimal hours, as the bank screen shows them (lib/hours-format.ts).
    used: string;
    total: string;
    remaining: string;
    overdrawn: boolean;
    pct: number;
    /// Where the bank should be by now, 0 to 100, for the mark on the bar.
    expectedPct: number | null;
  } | null;
  assessment: { attention: boolean; tone: "bad" | "warn" | "ok"; reasons: string[] } | null;
  rank: number;
  history: HistoryBar[];
};

export type ClientsSummary = {
  remaining: string;
  used: string;
  withBank: number;
  overranCount: number;
  overranNames: string;
  endingCount: number;
  endingNames: string;
};

const CHIP: Record<"attention" | "ok" | "none" | "paused" | "archived", { label: string; className: string }> = {
  attention: { label: "דורש תשומת לב", className: "bg-app-error-soft text-app-error" },
  ok: { label: "בקצב", className: "bg-app-success-soft text-app-success" },
  none: { label: "בלי בנק שעות", className: "bg-app-neutral-soft text-app-text-secondary" },
  paused: { label: "מושהה", className: "bg-app-warning-soft text-app-warning" },
  archived: { label: "בארכיון", className: "bg-app-neutral-soft text-app-text-secondary" },
};

const REASON_TONE = {
  bad: "bg-app-error-soft text-app-error font-medium",
  warn: "bg-app-warning-soft text-app-warning font-medium",
  ok: "bg-app-success-soft text-app-success",
} as const;

const PILL = "inline-flex min-h-11 items-center rounded-full border border-app-border px-3.5 text-xs text-app-text-primary hover:border-gold";

function chipOf(c: ClientCard) {
  if (c.status === "PAUSED") return CHIP.paused;
  if (c.status === "ARCHIVED") return CHIP.archived;
  if (!c.assessment) return CHIP.none;
  return c.assessment.attention ? CHIP.attention : CHIP.ok;
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : `${n} ${many}`;
}

// App redesign (handoff README, screen 5): live search (filters
// immediately, no submit button) + a card grid replacing the old table.
// Client-side filtering only - listClients() already returns every
// non-archived client, a small enough set for this to be instant without
// a server round-trip per keystroke.
//
// 19.10.2026: the search is mirrored into `?q=` with replaceState, so
// opening a client and coming back (browser back or the screen's own
// back link) lands on the same narrowed list. replaceState, not the
// router: no navigation, no RSC fetch, nothing that can be aborted, and
// no history entry per keystroke.
//
// 3.11.2026 (Ariel): one grid, the ones that need attention first. Every
// card shows its hours "X of Y", why it needs attention, its last cycles,
// and the same three buttons; the rest is in the card's menu.
function mirrorQuery(q: string) {
  const url = new URL(window.location.href);
  if (q) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

export function ClientsGrid({
  cards,
  initialQuery = "",
  canManageBanks,
  canViewReports,
  summary,
  rulesLine,
}: {
  cards: ClientCard[];
  initialQuery?: string;
  canManageBanks: boolean;
  canViewReports: boolean;
  summary: ClientsSummary;
  rulesLine: string;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState(cards);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuFor]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items;
    return items.filter((c) => c.name.includes(q));
  }, [items, query]);

  const fromParam = query.trim() ? new URLSearchParams({ q: query.trim() }).toString() : "";

  async function handleArchive(client: ClientCard) {
    setMenuFor(null);
    const result = await archiveClientAction(client.id);
    if (!result.ok) {
      showToast({ tone: "error", title: "הפעולה נכשלה", description: result.error });
      return;
    }
    setItems((prev) => prev.filter((c) => c.id !== client.id));
    showToast({
      tone: "warning",
      title: "הלקוח הועבר לארכיון",
      description: client.name,
      undo: async () => {
        const restored = await restoreClientAction(client.id);
        if (restored.ok) {
          setItems((prev) => (prev.some((c) => c.id === client.id) ? prev : [...prev, client]));
        }
      },
    });
  }

  return (
    <div className="space-y-4">
      {summary.withBank > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="clients-summary">
          <div className="rounded-2xl border border-app-border bg-white px-5 py-4">
            <p className="text-xs text-app-text-secondary">יתרה כוללת בבנקים</p>
            <p dir="ltr" className="mt-1.5 text-end font-jbmono text-2xl font-medium text-app-text-primary">{summary.remaining}</p>
            <p className="mt-1 text-xs text-app-text-secondary">שעות, ב-{plural(summary.withBank, "לקוח אחד", "לקוחות")} עם בנק</p>
          </div>
          <div className="rounded-2xl border border-app-border bg-white px-5 py-4">
            <p className="text-xs text-app-text-secondary">נוצל במחזורים הנוכחיים</p>
            <p dir="ltr" className="mt-1.5 text-end font-jbmono text-2xl font-medium text-app-text-primary">{summary.used}</p>
            <p className="mt-1 text-xs text-app-text-secondary">שעות, מתחילת כל מחזור עד היום</p>
          </div>
          <div className="rounded-2xl border border-app-border bg-white px-5 py-4">
            <p className="text-xs text-app-text-secondary">חרגו במחזור הקודם</p>
            <p className={`mt-1.5 font-jbmono text-2xl font-medium ${summary.overranCount ? "text-app-error" : "text-app-text-primary"}`}>{summary.overranCount}</p>
            <p className="mt-1 text-xs text-app-text-secondary">{summary.overranNames || "אף לקוח"}</p>
          </div>
          <div className="rounded-2xl border border-app-border bg-white px-5 py-4">
            <p className="text-xs text-app-text-secondary">חבילות שעומדות להיגמר</p>
            <p className={`mt-1.5 font-jbmono text-2xl font-medium ${summary.endingCount ? "text-app-warning" : "text-app-text-primary"}`}>{summary.endingCount}</p>
            <p className="mt-1 text-xs text-app-text-secondary">{summary.endingNames || "אף חבילה"}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            mirrorQuery(e.target.value.trim());
          }}
          placeholder="חיפוש לקוח"
          aria-label="חיפוש לקוח"
          className="w-full max-w-xs rounded-full border border-app-border-strong bg-white px-4 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold sm:w-auto"
        />
      </div>
      <div className="space-y-1 text-xs text-app-text-secondary">
        <p className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3.5 w-0.5 bg-app-text-primary" />
          הקו על הפס: כמה היה צפוי להיות מנוצל עד היום.
        </p>
        <p>{rulesLine}</p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-secondary">
          {items.length === 0 ? "אין עדיין לקוחות. הוסיפו לקוח ראשון למעלה." : "לא נמצאו לקוחות התואמים את החיפוש."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => {
            const chip = chipOf(client);
            const bank = client.bank;
            const over = !!bank && bank.pct > 100;
            const barPct = bank ? Math.min(100, Math.max(0, bank.pct)) : 0;
            const open = menuFor === client.id;
            const href = withFrom(`/app/clients/${client.id}`, fromParam);
            const meta = [
              client.employeeCount === 0 ? "אין עדיין אנשי צוות מוקצים" : plural(client.employeeCount, "איש צוות מוקצה", "אנשי צוות מוקצים"),
              plural(client.openTasks, "משימה פתוחה אחת", "משימות פתוחות"),
            ];
            return (
              <article key={client.id} className="flex flex-col gap-3.5 rounded-2xl border border-app-border bg-white p-5" data-testid="client-card">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <Link
                      href={href}
                      title="פתיחת תיק הלקוח"
                      className="text-[15px] font-medium text-app-text-primary underline decoration-app-border-strong underline-offset-4 hover:text-app-text-accent"
                    >
                      {client.name}
                    </Link>
                    <p className="mt-1 text-xs text-app-text-secondary">{bank ? bank.kindLabel : "אין בנק שעות פעיל"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${chip.className}`}>{chip.label}</span>
                </div>

                {client.assessment && client.assessment.reasons.length > 0 && (
                  <p className={`rounded-xl px-3 py-2.5 text-[13px] ${REASON_TONE[client.assessment.tone]}`} data-testid="client-reason">
                    {client.assessment.reasons.join(" ")}
                  </p>
                )}

                {bank && (
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-xs text-app-text-secondary">
                          נוצל מתוך סך הכול (<span dir="ltr">{bank.pct}%</span>)
                        </p>
                        <p data-testid="client-hours">
                          <span dir="ltr" className={`font-jbmono text-[22px] font-medium ${over ? "text-app-error" : "text-app-text-primary"}`}>
                            {bank.used}
                          </span>{" "}
                          <span className="text-[13px] text-app-text-secondary">
                            מתוך <span dir="ltr" className="font-jbmono">{bank.total}</span> שעות
                          </span>
                        </p>
                        <p className="text-xs text-app-text-secondary">
                          {bank.overdrawn ? "חריגה של " : "נותרו "}
                          <span dir="ltr" className={`font-jbmono ${bank.overdrawn ? "text-app-error" : "text-app-text-primary"}`}>
                            {bank.overdrawn ? bank.remaining.replace("-", "") : bank.remaining}
                          </span>
                        </p>
                      </div>
                      {client.history.length > 1 && (
                        <figure className="flex flex-col items-end gap-1">
                          <div className="flex h-16 items-end gap-2" role="img" aria-label={client.history.map((h) => h.title).join(", ")}>
                            {client.history.map((h, i) => (
                              <div key={i} className="flex flex-col items-center gap-1" title={h.title}>
                                <div className="relative flex h-12 w-6 items-end">
                                  <span
                                    className={`block w-full rounded-t ${h.over ? "bg-app-error" : h.current ? "bg-gold/50" : "bg-gold"}`}
                                    style={{ height: `${Math.max(2, Math.round(h.usedShare * 48))}px` }}
                                  />
                                  {h.sizeShare !== null && (
                                    <span
                                      className="absolute -inset-x-1 border-t-2 border-dashed border-app-text-primary"
                                      style={{ bottom: `${Math.round(h.sizeShare * 48)}px` }}
                                    />
                                  )}
                                </div>
                                <span className="text-[11px] text-app-text-secondary">{h.label}</span>
                              </div>
                            ))}
                          </div>
                          <figcaption className="text-[11px] text-app-text-secondary">קו מקווקו: גודל המחזור</figcaption>
                        </figure>
                      )}
                    </div>
                    <div className="relative h-2 rounded-full bg-app-surface-sunken">
                      <span
                        className={`absolute inset-y-0 start-0 block rounded-full ${over ? "bg-app-error" : "bg-gold-gradient"}`}
                        style={{ width: `${barPct}%` }}
                      />
                      {bank.expectedPct !== null && (
                        <span
                          aria-hidden="true"
                          className="absolute -inset-y-1 w-0.5 bg-app-text-primary"
                          style={{ insetInlineStart: `${bank.expectedPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-app-text-secondary">
                  {meta.join(", ")}
                  {client.approvals > 0 && (
                    <>
                      {", "}
                      <Link href={`/app/approvals?clientId=${client.id}`} className="font-medium text-app-warning hover:underline">
                        {client.approvals === 1 ? "דבר אחד ממתין לאישורך" : `${client.approvals} ממתינים לאישורך`}
                      </Link>
                    </>
                  )}
                </p>

                <div className="mt-auto border-t border-app-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageBanks && (
                      <Link href={`/app/hour-banks?clientId=${client.id}`} className={PILL}>
                        {bank ? "בנק שעות" : "פתיחת בנק שעות"}
                      </Link>
                    )}
                    {canViewReports && (
                      <Link href={`/app/reports?tab=summary&clientId=${client.id}`} className={PILL}>
                        דוח פעילות
                      </Link>
                    )}
                    {/* Portal phase 0: an Ankora manager can open this
                        client's portal exactly as the client sees it. The
                        action sets a short-lived cookie and redirects; the
                        preview is read-only by construction
                        (assertPortalWritable) and audited on entry. */}
                    <form action={startPortalPreviewAction}>
                      <input type="hidden" name="clientId" value={client.id} />
                      <button type="submit" className={PILL}>
                        תצוגת לקוח
                      </button>
                    </form>
                    <div className="relative ms-auto">
                      <button
                        type="button"
                        onClick={() => setMenuFor(open ? null : client.id)}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        aria-label={`פעולות נוספות ל${client.name}`}
                        className={`flex h-11 w-11 items-center justify-center rounded-full border text-app-text-primary ${open ? "border-app-border-strong bg-app-surface-page" : "border-transparent hover:border-app-border"}`}
                      >
                        <MoreHorizontal size={18} strokeWidth={1.75} />
                      </button>
                      {open && (
                        <>
                          <button type="button" aria-label="סגירה" onClick={() => setMenuFor(null)} className="fixed inset-0 z-10 cursor-default" />
                          <div role="menu" className="absolute bottom-full end-0 z-20 mb-1.5 w-44 overflow-hidden rounded-lg border border-app-border bg-white py-1 shadow-lg">
                            <Link href={href} role="menuitem" onClick={() => setMenuFor(null)} className="block px-4 py-2.5 text-sm text-app-text-primary hover:bg-app-surface-page">
                              תיק הלקוח
                            </Link>
                            {client.status !== "ARCHIVED" && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleArchive(client)}
                                className="block w-full px-4 py-2.5 text-start text-sm text-app-error hover:bg-app-surface-page"
                              >
                                העברה לארכיון
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
