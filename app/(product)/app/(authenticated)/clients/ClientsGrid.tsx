"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { withFrom } from "@/lib/list-back";
import { useToast } from "@/components/app/toast/ToastProvider";
import { archiveClientAction, restoreClientAction } from "./actions";
import { startPortalPreviewAction } from "../portal/actions";
import type { ClientStatus } from "@prisma/client";

export type ClientCard = {
  id: string;
  name: string;
  status: ClientStatus;
  employeeCount: number;
  utilizationPct: number | null;
};

const STATUS_BADGE: Record<ClientStatus, string> = {
  ACTIVE: "bg-app-success-soft text-app-success",
  PAUSED: "bg-app-warning-soft text-app-warning",
  ARCHIVED: "bg-app-neutral-soft text-app-text-secondary",
};

const STATUS_LABEL: Record<ClientStatus, string> = {
  ACTIVE: "פעיל",
  PAUSED: "מושהה",
  ARCHIVED: "בארכיון",
};

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
}: {
  cards: ClientCard[];
  initialQuery?: string;
  canManageBanks: boolean;
  canViewReports: boolean;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState(cards);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items;
    return items.filter((c) => c.name.includes(q));
  }, [items, query]);

  async function handleArchive(client: ClientCard) {
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
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          mirrorQuery(e.target.value.trim());
        }}
        placeholder="חיפוש לקוח"
        className="w-full max-w-xs rounded-full border border-app-border-strong bg-white px-4 py-2.5 text-sm text-app-text-primary outline-none focus:border-gold sm:w-auto"
      />

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-secondary">
          {items.length === 0 ? "אין עדיין לקוחות. הוסיפו לקוח ראשון למעלה." : "לא נמצאו לקוחות התואמים את החיפוש."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((client) => {
            const pct = client.utilizationPct;
            const high = pct !== null && pct > 100;
            const barPct = pct === null ? 0 : Math.min(100, pct);
            return (
              <div key={client.id} className="rounded-2xl border border-app-border bg-white p-5">
                <div className="flex items-center justify-between gap-2.5">
                  <Link href={withFrom(`/app/clients/${client.id}`, query.trim() ? new URLSearchParams({ q: query.trim() }).toString() : "")} className="text-[15px] font-medium text-app-text-primary hover:text-app-text-accent">
                    {client.name}
                  </Link>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[client.status]}`}>
                    {STATUS_LABEL[client.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-app-text-secondary">
                  {client.employeeCount === 0 ? "אין עדיין אנשי צוות מוקצים" : `${client.employeeCount} אנשי צוות מוקצים`}
                </p>

                <div className="mt-4 flex items-baseline justify-between gap-2.5">
                  <span className="text-xs text-app-text-secondary">ניצול מחזור</span>
                  <span
                    dir="ltr"
                    className={`font-jbmono text-[15px] ${high ? "text-app-error" : "text-app-text-primary"}`}
                  >
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-app-surface-sunken">
                  <span
                    className={`block h-full rounded-full ${high ? "bg-app-error" : "bg-gold-gradient"}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {canManageBanks && (
                    <Link
                      href={`/app/hour-banks?clientId=${client.id}`}
                      className="rounded-full border border-app-border px-3.5 py-2 text-xs text-app-text-primary hover:border-gold"
                    >
                      בנק שעות
                    </Link>
                  )}
                  {canViewReports && (
                    <Link
                      href={`/app/reports?tab=summary&clientId=${client.id}`}
                      className="rounded-full border border-app-border px-3.5 py-2 text-xs text-app-text-primary hover:border-gold"
                    >
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
                    <button
                      type="submit"
                      className="rounded-full border border-app-border px-3.5 py-2 text-xs text-app-text-primary hover:border-gold"
                    >
                      תצוגת לקוח
                    </button>
                  </form>
                  {client.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => handleArchive(client)}
                      className="px-1.5 py-2 text-xs text-app-text-tertiary hover:text-app-error"
                    >
                      העברה לארכיון
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
