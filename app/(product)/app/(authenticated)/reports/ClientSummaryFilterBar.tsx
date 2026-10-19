"use client";
import { useState } from "react";

// 20.10.2026: a document navigation, not the router. A router navigation
// can be dropped and leave the screen unchanged while the address says the
// filter was applied; a document navigation cannot. Same rule as
// TaskFilters and the knowledge review filters
// (claude/search-navigation-lost-2026-09-25.md).
function go(href: string) {
  window.location.assign(href);
}

type Option = { id: string; name: string };

// docs/adr/0001 section 19.14: the "תקציר פעילות ללקוח" tab has a
// deliberately smaller filter set than ReportFilterBar.tsx - just client
// (required - a summary meant for one client shouldn't ever mix in
// another client's internal notes) and a date range. No user/category/
// source/edited/manual filters; the point is to hand an external AI as
// much of one client's own activity as possible, not to slice it further.
export function ClientSummaryFilterBar({
  clients,
  current,
}: {
  clients: Option[];
  current: { clientId?: string; from?: string; to?: string };
}) {
  const [clientId, setClientId] = useState(current.clientId ?? "");
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");

  function apply() {
    const params = new URLSearchParams({ tab: "summary" });
    if (clientId) params.set("clientId", clientId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    go(`/app/reports?${params.toString()}`);
  }

  function clear() {
    setClientId("");
    setFrom("");
    setTo("");
    go("/app/reports?tab=summary");
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-app-border bg-white p-6 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">לקוח *</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="">בחרו לקוח...</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">מתאריך</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">עד תאריך</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div className="flex items-end gap-3">
        <button
          type="button"
          onClick={apply}
          className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-text-primary"
        >
          צור תקציר
        </button>
        <button type="button" onClick={clear} className="text-sm text-app-text-secondary hover:text-app-text-primary">
          איפוס
        </button>
      </div>
    </div>
  );
}
