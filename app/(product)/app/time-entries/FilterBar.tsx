"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; name: string };

// Spec 14.3: "Filters נשמרים ב-URL/query state כדי לאפשר link/share
// פנימי" - applies to reports there, and the same convention carries over
// to this cross-client table.
export function FilterBar({
  clients,
  users,
  current,
}: {
  clients: Option[];
  users: Option[];
  current: { clientId?: string; userId?: string; from?: string; to?: string };
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(current.clientId ?? "");
  const [userId, setUserId] = useState(current.userId ?? "");
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (clientId) params.set("clientId", clientId);
    if (userId) params.set("userId", userId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/app/time-entries?${params.toString()}`);
  }

  function clear() {
    setClientId("");
    setUserId("");
    setFrom("");
    setTo("");
    router.push("/app/time-entries");
  }

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-lineDark bg-white p-6 sm:grid-cols-2 lg:grid-cols-5">
      <div>
        <label className="block text-xs font-medium text-navy/60">לקוח</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">כל הלקוחות</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-navy/60">עובד</label>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">כל העובדים</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
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
          סינון
        </button>
        <button type="button" onClick={clear} className="text-sm text-navy/60 hover:text-navy">
          איפוס
        </button>
      </div>
    </div>
  );
}
