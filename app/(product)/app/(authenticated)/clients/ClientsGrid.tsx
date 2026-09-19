"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/app/toast/ToastProvider";
import { archiveClientAction, restoreClientAction } from "./actions";
import type { ClientStatus } from "@prisma/client";

export type ClientCard = {
  id: string;
  name: string;
  status: ClientStatus;
  employeeCount: number;
  utilizationPct: number | null;
};

const STATUS_BADGE: Record<ClientStatus, string> = {
  ACTIVE: "bg-success-soft text-success",
  PAUSED: "bg-warning-soft text-warning",
  ARCHIVED: "bg-neutral-soft text-neutral",
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
export function ClientsGrid({
  cards,
  canManageBanks,
  canViewReports,
}: {
  cards: ClientCard[];
  canManageBanks: boolean;
  canViewReports: boolean;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
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
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חיפוש לקוח"
        className="w-full max-w-xs rounded-full border border-lineDark bg-white px-4 py-2.5 text-sm text-navy outline-none focus:border-gold sm:w-auto"
      />

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/55">
          {items.length === 0 ? "אין עדיין לקוחות. הוסיפו לקוח ראשון למעלה." : "לא נמצאו לקוחות התואמים את החיפוש."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((client) => {
            const pct = client.utilizationPct;
            const high = pct !== null && pct > 100;
            const barPct = pct === null ? 0 : Math.min(100, pct);
            return (
              <div key={client.id} className="rounded-2xl border border-lineDark bg-white p-5">
                <div className="flex items-center justify-between gap-2.5">
                  <Link href={`/app/clients/${client.id}`} className="text-[15px] font-medium text-navy hover:text-gold-dim">
                    {client.name}
                  </Link>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[client.status]}`}>
                    {STATUS_LABEL[client.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-navy/55">
                  {client.employeeCount === 0 ? "אין עדיין עובדים מוקצים" : `${client.employeeCount} עובדים מוקצים`}
                </p>

                <div className="mt-4 flex items-baseline justify-between gap-2.5">
                  <span className="text-xs text-navy/55">ניצול מחזור</span>
                  <span
                    dir="ltr"
                    className={`font-jbmono text-[15px] ${high ? "text-error" : "text-navy"}`}
                  >
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy/8">
                  <span
                    className={`block h-full rounded-full ${high ? "bg-error" : "bg-gold-gradient"}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {canManageBanks && (
                    <Link
                      href={`/app/hour-banks?clientId=${client.id}`}
                      className="rounded-full border border-lineDark px-3.5 py-2 text-xs text-navy hover:border-gold"
                    >
                      בנק שעות
                    </Link>
                  )}
                  {canViewReports && (
                    <Link
                      href={`/app/reports?tab=summary&clientId=${client.id}`}
                      className="rounded-full border border-lineDark px-3.5 py-2 text-xs text-navy hover:border-gold"
                    >
                      דוח פעילות
                    </Link>
                  )}
                  {client.status !== "ARCHIVED" && (
                    <button
                      type="button"
                      onClick={() => handleArchive(client)}
                      className="px-1.5 py-2 text-xs text-navy/50 hover:text-error"
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
