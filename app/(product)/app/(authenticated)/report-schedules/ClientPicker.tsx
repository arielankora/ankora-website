"use client";
// 20.10.2026: a document navigation, not the router: one cannot be
// dropped while the address already says the client changed
// (claude/search-navigation-lost-2026-09-25.md).

type Option = { id: string; name: string };

// Same ?clientId= URL-state convention as /app/hour-banks and /app/alerts.
export function ClientPicker({ clients, current }: { clients: Option[]; current: string }) {
  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <label className="block text-xs font-medium text-app-text-secondary">לקוח</label>
      <select
        defaultValue={current}
        onChange={(e) => window.location.assign(`/app/reports?tab=schedules&clientId=${e.target.value}`)}
        className="mt-1.5 w-full max-w-sm rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
      >
        <option value="">בחרו לקוח...</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
