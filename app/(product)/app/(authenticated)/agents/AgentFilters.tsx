"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NO_CATEGORY } from "@/lib/agents/categories";

// Agents (24.11.2026): the agents screen's filters, kept in the address so
// a filtered screen can be shared and comes back on refresh. Categories
// are many at once (an agent in any of them shows), "none" is the agents
// in no category, and the client is the one its installations run on.

const CHIP = "tap-area rounded-full border px-3 py-1 text-[13px]";
const ON = "border-app-text-primary bg-app-text-primary text-white";
const OFF = "border-app-border bg-white text-app-text-primary";

export function AgentFilters({ categories, clients }: { categories: { id: string; name: string }[]; clients: { id: string; name: string }[] }) {
  const t = useTranslations("agents.list.filters");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.getAll("cat");
  const grouped = params.get("group") === "1";
  const client = params.get("client") ?? "";
  const [query, setQuery] = useState(params.get("q") ?? "");

  function go(next: URLSearchParams) {
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }
  function toggle(id: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("cat");
    for (const c of selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) next.append("cat", c);
    go(next);
  }
  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    go(next);
  }

  // The search reaches the address a moment after typing stops.
  useEffect(() => {
    if (query === (params.get("q") ?? "")) return;
    const id = setTimeout(() => set("q", query.trim()), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 28.11.2026: capped at the screen's width. The client list is as wide
  // as its longest client name, and on a 320px phone it pushed the whole
  // page sideways (QA, phone layout).
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
    <input
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={t("search")}
      aria-label={t("search")}
      dir="auto"
      className="w-full max-w-md rounded-full border border-app-border bg-white px-4 py-1.5 text-[13px] text-app-text-primary outline-none focus:border-gold"
    />
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("label")}>
      <button type="button" onClick={() => set("cat", "")} aria-pressed={selected.length === 0} className={`${CHIP} ${selected.length === 0 ? ON : OFF}`}>
        {t("all")}
      </button>
      {categories.map((c) => (
        <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={selected.includes(c.id)} className={`${CHIP} ${selected.includes(c.id) ? ON : OFF}`} dir="auto">
          {c.name}
        </button>
      ))}
      {categories.length > 0 && (
        <button type="button" onClick={() => toggle(NO_CATEGORY)} aria-pressed={selected.includes(NO_CATEGORY)} className={`${CHIP} ${selected.includes(NO_CATEGORY) ? ON : OFF}`}>
          {t("none")}
        </button>
      )}
      <span className="mx-1 h-5 w-px bg-app-border" aria-hidden />
      <select value={client} onChange={(e) => set("client", e.target.value)} aria-label={t("client")} className="max-w-full rounded-full border border-app-border bg-white px-3 py-1 text-[13px] text-app-text-primary">
        <option value="">{t("allClients")}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {categories.length > 0 && (
        <label className="flex items-center gap-1.5 text-[13px] text-app-text-primary">
          <input type="checkbox" checked={grouped} onChange={(e) => set("group", e.target.checked ? "1" : "")} />
          {t("group")}
        </label>
      )}
    </div>
    </div>
  );
}
