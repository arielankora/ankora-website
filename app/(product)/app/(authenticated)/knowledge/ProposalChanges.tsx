"use client";
import { useFormatter, useTranslations } from "next-intl";
import { CODE_FIELDS, type ChangeValue, type ProposalChange } from "@/lib/proposal-changes";
import type { KnowledgeT } from "./labels";

// What an update to an item in the file changes (19.11.2026, Ariel; the
// options are on the design canvas of that day, option A chosen with B on
// a phone): field by field, what the file says today and what it will say
// once approved. It replaces a struck-out line of the item, which read as
// "this is deleted" when the item only gained a role.

type Key = Parameters<KnowledgeT>[0];

function useValueText() {
  const t = useTranslations("knowledge");
  const format = useFormatter();
  const word = (key: string, fallback: string) => (t.has(key as Key) ? t(key as Key) : fallback);
  const code = (field: string, v: string) => {
    if (field === "kind") return word(`factKinds.${v}`, word(`policyKinds.${v}`, v));
    return word(`changes.values.${v}`, v);
  };
  return (field: string, v: ChangeValue): string | null => {
    if (v === null) return null;
    if (typeof v === "boolean") return t(v ? "changes.yes" : "changes.no");
    if (field === "steps" && typeof v === "number") return t("changes.steps", { count: v });
    if (typeof v === "number") return format.number(v);
    if (Array.isArray(v)) return v.map((x) => (CODE_FIELDS.has(field) ? code(field, x) : x)).join(", ");
    return CODE_FIELDS.has(field) ? code(field, v) : v;
  };
}

/// `applied`: a change already made (an update that entered on its own,
/// 28.11.2026), worded as what was and what is now.
export function ProposalChanges({ changes, applied = false }: { changes: ProposalChange[]; applied?: boolean }) {
  const t = useTranslations("knowledge");
  const head = applied
    ? { before: t("changes.applied.before"), after: t("changes.applied.after"), removed: t("changes.applied.removed"), rest: t("changes.applied.rest") }
    : { before: t("changes.before"), after: t("changes.after"), removed: t("changes.removed"), rest: t("changes.rest") };
  const text = useValueText();
  const label = (field: string) => (t.has(`changes.fields.${field}` as Key) ? t(`changes.fields.${field}` as Key) : field);
  const before = (c: ProposalChange) => (c.beforeKnown ? text(c.field, c.before) : null);
  const beforeEmpty = (c: ProposalChange) => (c.beforeKnown ? t("changes.empty") : t("changes.unknown"));
  const after = (c: ProposalChange) => text(c.field, c.after);
  if (changes.length === 0) return null;
  return (
    <div className="mt-2" data-testid="proposal-changes">
      {/* From sm up: a table, the field, today and after approval. */}
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="text-start text-xs text-app-text-tertiary">
            <th scope="col" className="w-28 px-2 py-1.5 text-start font-medium">
              {t("changes.field")}
            </th>
            <th scope="col" className="w-1/3 px-2 py-1.5 text-start font-medium">
              {head.before}
            </th>
            <th scope="col" className="px-2 py-1.5 text-start font-medium">
              {head.after}
            </th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field} className="border-t border-app-border align-top">
              <th scope="row" className="px-2 py-2 text-start font-medium text-app-text-secondary">
                {label(c.field)}
              </th>
              <td className="whitespace-pre-line px-2 py-2 text-app-text-tertiary" dir="auto">
                {before(c) ?? <span className="whitespace-nowrap">{beforeEmpty(c)}</span>}
              </td>
              <td className="whitespace-pre-line bg-app-accent-soft px-2 py-2 font-medium text-app-text-primary" dir="auto">
                {after(c) ?? <span className="font-normal text-app-text-secondary">{head.removed}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* On a phone: one line per field, today, an arrow, after approval. */}
      <ul className="flex flex-col gap-2 text-sm sm:hidden">
        {changes.map((c) => (
          <li key={c.field}>
            <p className="text-xs font-medium text-app-text-secondary">{label(c.field)}</p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-app-text-tertiary" dir="auto">
                {before(c) ?? beforeEmpty(c)}
              </span>
              {/* "Becomes", read in the line's direction. */}
              <span aria-hidden="true" className="text-app-border-strong">
                {t("changes.arrow")}
              </span>
              <span className="sr-only">{t("changes.becomes")}</span>
              <span className="rounded-md bg-app-accent-soft px-2 py-0.5 font-medium text-app-text-primary" dir="auto">
                {after(c) ?? head.removed}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-app-text-tertiary">{head.rest}</p>
    </div>
  );
}
