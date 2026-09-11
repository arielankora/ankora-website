"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const router = useRouter();
  const [clientId, setClientId] = useState(current.clientId ?? "");
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");

  function apply() {
    const params = new URLSearchParams({ tab: "summary" });
    if (clientId) params.set("clientId", clientId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/app/reports?${params.toString()}`);
  }

  function clear() {
    setClientId("");
    setFrom("");
    setTo("");
    router.push("/app/reports?tab=summary");
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="block text-xs font-medium text-navy/60">לקוח *</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
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
        <label className="block text-xs font-medium text-navy/60">מתאריך</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">עד תאריך</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>
      <div className="flex items-end gap-3">
        <button
          type="button"
          onClick={apply}
          className="rounded-full bg-gold-gradient px-4 py-2 text-sm font-medium text-ink"
        >
          צור תקציר
        </button>
        <button type="button" onClick={clear} className="text-sm text-navy/60 hover:text-navy">
          איפוס
        </button>
      </div>
    </div>
  );
}
