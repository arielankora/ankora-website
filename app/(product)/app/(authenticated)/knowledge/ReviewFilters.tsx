"use client";
import { useRef } from "react";
import { AGE_OPTIONS, reviewFiltersHref, type ReviewFilters } from "@/lib/knowledge-review-filters";
import { SOURCE_KIND_LABELS } from "@/lib/knowledge-sources";

// The filter bar on "ממתין לאישור"
// (claude/knowledge-review-filters-spec-2026-10-17.md).
//
// Same navigation rule as TaskFilters, for the same reason: a real
// `<form method="get">` and plain `<a href>`, never the router. A
// router navigation can be dropped and leave the screen unchanged; a
// document navigation cannot. The screen behind this is a Server
// Component that reads the URL, so the URL is the only state here.
//
// One line: client, kind and "needs attention" are always in view.
// Source, sender and age wait under "עוד", open when one of them is set.

export type FilterOption = { value: string; label: string; count: number };

const CHIP = "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors";
const CHIP_OFF = "border-app-border bg-white text-app-text-secondary hover:border-gold/60 hover:text-app-text-primary";
const CHIP_ON = "border-gold bg-gold/10 font-medium text-app-text-primary";

export function ReviewFilterBar({
  filters,
  clients,
  kinds,
  sources,
  people,
  attentionCount,
}: {
  filters: ReviewFilters;
  clients: FilterOption[];
  kinds: FilterOption[];
  sources: FilterOption[];
  people: FilterOption[];
  attentionCount: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();
  const toggleKind = (k: string) =>
    reviewFiltersHref({ ...filters, kinds: filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k] });
  const more = !!filters.source || !!filters.by || filters.age !== null;
  const any = more || !!filters.clientId || filters.kinds.length > 0 || filters.attention;

  // A client chosen by link that has nothing waiting is still shown as
  // chosen, so the select never claims "all clients" while one is set.
  const clientOptions = filters.clientId && !clients.some((c) => c.value === filters.clientId)
    ? [...clients, { value: filters.clientId, label: "לקוח שנבחר", count: 0 }]
    : clients;

  return (
    <form ref={formRef} method="get" action="/app/approvals" aria-label="סינון הצעות" className="space-y-2.5">
      {/* The review screen is a tab of "אישורים" (20.10.2026). */}
      <input type="hidden" name="tab" value="knowledge" />
      {/* What the chips own, carried so a select change keeps them. */}
      {filters.kinds.map((k) => (
        <input key={k} type="hidden" name="kind" value={k} />
      ))}
      {filters.attention && <input type="hidden" name="attention" value="1" />}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="לקוח"
          name="clientId"
          value={filters.clientId ?? ""}
          options={[{ value: "", label: "כל הלקוחות" }, ...clientOptions.map((c) => ({ value: c.value, label: c.count ? `${c.label} (${c.count})` : c.label }))]}
          onChange={submit}
        />

        {attentionCount > 0 || filters.attention ? (
          <a
            href={reviewFiltersHref({ ...filters, attention: !filters.attention })}
            aria-current={filters.attention ? "true" : undefined}
            title="רגיש, משנה פריט קיים, אולי כבר בתיק, או שכלל סימן אותו"
            className={`${CHIP} ${filters.attention ? CHIP_ON : CHIP_OFF}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${filters.attention ? "bg-gold" : "bg-app-warning"}`} aria-hidden />
            דורש תשומת לב <span className="text-app-text-tertiary">{attentionCount}</span>
          </a>
        ) : null}

        <span className="mx-1 hidden h-5 w-px bg-app-border sm:block" aria-hidden />

        {kinds.map((k) => {
          const on = filters.kinds.includes(k.value);
          return (
            <a key={k.value} href={toggleKind(k.value)} aria-current={on ? "true" : undefined} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
              {k.label} <span className="text-app-text-tertiary">{k.count}</span>
            </a>
          );
        })}
        {/* A kind chosen by link that has nothing left still shows, so it can be turned off. */}
        {filters.kinds
          .filter((k) => !kinds.some((o) => o.value === k))
          .map((k) => (
            <a key={k} href={toggleKind(k)} aria-current="true" className={`${CHIP} ${CHIP_ON}`}>
              {k} <span className="text-app-text-tertiary">0</span>
            </a>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <details open={more} className="group">
          <summary className="cursor-pointer list-none text-app-text-secondary hover:text-app-text-primary">
            עוד סינונים<span className="ms-1 inline-block transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select
              label="מקור"
              name="source"
              value={filters.source ?? ""}
              options={[{ value: "", label: "כל המקורות" }, ...sources.map((s) => ({ value: s.value, label: `${SOURCE_KIND_LABELS[s.value as keyof typeof SOURCE_KIND_LABELS] ?? s.label} (${s.count})` }))]}
              onChange={submit}
            />
            <Select
              label="נשלח על ידי"
              name="by"
              value={filters.by ?? ""}
              options={[{ value: "", label: "כולם" }, ...people.map((p) => ({ value: p.value, label: `${p.label} (${p.count})` }))]}
              onChange={submit}
            />
            <Select
              label="ממתין"
              name="age"
              value={filters.age !== null ? String(filters.age) : ""}
              options={[{ value: "", label: "כל זמן" }, ...AGE_OPTIONS.map((d) => ({ value: String(d), label: `יותר מ-${d} ימים` }))]}
              onChange={submit}
            />
          </div>
        </details>
        {any && (
          <a href={reviewFiltersHref({ clientId: null, kinds: [], attention: false, source: null, by: null, age: null })} className="text-app-text-accent hover:underline">
            ניקוי הסינון
          </a>
        )}
      </div>
    </form>
  );
}

function Select({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-app-border bg-white px-3 py-1.5 text-[12.5px]">
      <span className="text-app-text-tertiary">{label}</span>
      <select
        // Unset contributes nothing to the URL rather than `?source=`.
        name={value ? name : undefined}
        aria-label={label}
        value={value}
        onChange={(e) => {
          // Named before submit, so choosing a value from "all" is sent.
          e.currentTarget.name = e.currentTarget.value ? name : "";
          onChange();
        }}
        className="max-w-[200px] cursor-pointer truncate bg-transparent font-medium text-app-text-primary outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
