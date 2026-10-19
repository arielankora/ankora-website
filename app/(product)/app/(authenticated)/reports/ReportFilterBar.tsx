"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReportType } from "@/lib/app-domain/reports";
import { ExportMenu } from "@/components/app/ExportMenu";

type Option = { id: string; name: string };

interface Current {
  type: ReportType;
  clientId?: string;
  userId?: string;
  categoryId?: string;
  source?: string;
  editedOnly?: string;
  manualOnly?: string;
  from?: string;
  to?: string;
}

// Spec 14.3: "Filters נשמרים ב-URL/query state כדי לאפשר link/share פנימי"
// - same convention as app/(product)/app/time-entries/FilterBar.tsx, plus
// the report-type selector itself and the extra filters 14.3 lists that
// the time-entries screen didn't need (category, source, edited/manual).
export function ReportFilterBar({
  reportTypes,
  clients,
  users,
  categories,
  current,
}: {
  reportTypes: { id: ReportType; label: string }[];
  clients: Option[];
  users: Option[];
  categories: Option[];
  current: Current;
}) {
  const router = useRouter();
  const [type, setType] = useState<ReportType>(current.type);
  const [clientId, setClientId] = useState(current.clientId ?? "");
  const [userId, setUserId] = useState(current.userId ?? "");
  const [categoryId, setCategoryId] = useState(current.categoryId ?? "");
  const [source, setSource] = useState(current.source ?? "");
  const [editedOnly, setEditedOnly] = useState(current.editedOnly === "1");
  const [manualOnly, setManualOnly] = useState(current.manualOnly === "1");
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");

  function buildParams() {
    const params = new URLSearchParams();
    params.set("type", type);
    if (clientId) params.set("clientId", clientId);
    if (userId) params.set("userId", userId);
    if (categoryId) params.set("categoryId", categoryId);
    if (source) params.set("source", source);
    if (editedOnly) params.set("editedOnly", "1");
    if (manualOnly) params.set("manualOnly", "1");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }

  function apply() {
    router.push(`/app/reports?${buildParams().toString()}`);
  }

  function clear() {
    setClientId("");
    setUserId("");
    setCategoryId("");
    setSource("");
    setEditedOnly(false);
    setManualOnly(false);
    setFrom("");
    setTo("");
    router.push(`/app/reports?type=${type}`);
  }

  const exportHref = `/api/reports/export?${buildParams().toString()}`;

  return (
    <div className="space-y-4 rounded-2xl border border-app-border bg-white p-6">
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">סוג דוח</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ReportType)}
          className="mt-1.5 w-full max-w-md rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          {reportTypes.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">לקוח</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
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
          <label className="block text-xs font-medium text-app-text-secondary">איש צוות</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">כל אנשי הצוות</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">קטגוריה</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">מקור</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">הכול</option>
            <option value="MANUAL">דיווח ידני</option>
            <option value="TIMER">טיימר</option>
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
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-app-text-secondary">
            <input type="checkbox" checked={editedOnly} onChange={(e) => setEditedOnly(e.target.checked)} />
            נערכו בלבד
          </label>
          <label className="flex items-center gap-2 text-sm text-app-text-secondary">
            <input type="checkbox" checked={manualOnly} onChange={(e) => setManualOnly(e.target.checked)} />
            ידניים בלבד
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={apply}
          className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-text-primary"
        >
          הצגת דוח
        </button>
        <button type="button" onClick={clear} className="text-sm text-app-text-secondary hover:text-app-text-primary">
          איפוס
        </button>
        <ExportMenu baseHref={exportHref} />
      </div>
    </div>
  );
}