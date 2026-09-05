"use client";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };

// Spec 14.3's URL-state convention (also used by /app/time-entries's
// FilterBar): the selected client lives in ?clientId= so the page is
// shareable/bookmarkable per client.
export function HbClientPicker({ clients, current }: { clients: Option[]; current: string }) {
  const router = useRouter();

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <label className="block text-xs font-medium text-navy/60">לקוח</label>
      <select
        defaultValue={current}
        onChange={(e) => router.push(`/app/hour-banks?clientId=${e.target.value}`)}
        className="mt-1.5 w-full max-w-sm rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
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
