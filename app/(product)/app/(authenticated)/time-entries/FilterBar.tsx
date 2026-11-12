"use client";
import { useState } from "react";
import { ExportMenu } from "@/components/app/ExportMenu";
import { useTranslations } from "next-intl";

// 20.10.2026: a document navigation, not the router. A router navigation
// can be dropped and leave the screen unchanged while the address says the
// filter was applied; a document navigation cannot. Same rule as
// TaskFilters and the knowledge review filters
// (claude/search-navigation-lost-2026-09-25.md).
function go(href: string) {
  window.location.assign(href);
}

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
  const t = useTranslations("timeEntriesAdmin.filters");
  const [clientId, setClientId] = useState(current.clientId ?? "");
  const [userId, setUserId] = useState(current.userId ?? "");
  const [from, setFrom] = useState(current.from ?? "");
  const [to, setTo] = useState(current.to ?? "");

  function buildParams() {
    const params = new URLSearchParams();
    if (clientId) params.set("clientId", clientId);
    if (userId) params.set("userId", userId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }

  function apply() {
    go(`/app/time-entries?${buildParams().toString()}`);
  }

  function clear() {
    setClientId("");
    setUserId("");
    setFrom("");
    setTo("");
    go("/app/time-entries");
  }

  // Same export-button pattern as app/(product)/app/reports/
  // ReportFilterBar.tsx's exportHref - mirrors the current on-screen
  // filters into app/api/time-entries/export/route.ts's query params.
  const exportHref = `/api/time-entries/export?${buildParams().toString()}`;

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-app-border bg-white p-6 sm:grid-cols-2 lg:grid-cols-5">
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("client")}</label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="">{t("allClients")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id} dir="auto">
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("employee")}</label>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="">{t("allEmployees")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id} dir="auto">
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("from")}</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("to")}</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={apply}
          className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-text-primary"
        >
          {t("apply")}
        </button>
        <button type="button" onClick={clear} className="text-sm text-app-text-secondary hover:text-app-text-primary">
          {t("reset")}
        </button>
        <ExportMenu baseHref={exportHref} />
      </div>
    </div>
  );
}
