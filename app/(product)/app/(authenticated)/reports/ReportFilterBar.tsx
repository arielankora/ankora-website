"use client";
import { useState } from "react";
import type { ReportType } from "@/lib/app-domain/reports";
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
  const t = useTranslations("reports.filters");
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
    go(`/app/reports?${buildParams().toString()}`);
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
    go(`/app/reports?type=${type}`);
  }

  const exportHref = `/api/reports/export?${buildParams().toString()}`;

  return (
    <div className="space-y-4 rounded-2xl border border-app-border bg-white p-6">
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("reportType")}</label>
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
          <label className="block text-xs font-medium text-app-text-secondary">{t("category")}</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">{t("allCategories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} dir="auto">
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("source")}</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">{t("allSources")}</option>
            <option value="MANUAL">{t("manual")}</option>
            <option value="TIMER">{t("timer")}</option>
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
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-app-text-secondary">
            <input type="checkbox" checked={editedOnly} onChange={(e) => setEditedOnly(e.target.checked)} />
            {t("editedOnly")}
          </label>
          <label className="flex items-center gap-2 text-sm text-app-text-secondary">
            <input type="checkbox" checked={manualOnly} onChange={(e) => setManualOnly(e.target.checked)} />
            {t("manualOnly")}
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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