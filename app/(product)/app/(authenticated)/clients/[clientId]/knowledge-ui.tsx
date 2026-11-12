"use client";
import { createContext, useContext, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ITEM_MISSING_FIELDS, type KnowledgeAudienceLike, type KnowledgeStatusLike, type MissingFieldsTarget } from "@/lib/knowledge";

// The pieces every section of the client file draws the same way: the
// form field, the status line with what would close it, and the sources.
// Shared so people, organizations and systems cannot drift apart.

/// `secondary`: an Ankora document (R14). It records, it cannot confirm.
export type SourceOption = { code: string; title: string; secondary?: boolean };
export type EntityOption = { id: string; name: string };

export const STATUS_TONE: Record<KnowledgeStatusLike, "green" | "amber" | "gray" | "red"> = {
  CONFIRMED: "green",
  UNCERTAIN: "amber",
  MISSING: "red",
  SUPERSEDED: "gray",
};

export const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
export const LABEL = "block text-xs font-medium text-app-text-secondary";

type KnowledgeT = ReturnType<typeof useTranslations<"clients.knowledge">>;

/// A field the form can mark missing (lib/knowledge.ts ITEM_MISSING_FIELDS),
/// in the reader's language. The lib labels stay what the client file says.
export function missingFieldLabel(t: KnowledgeT, target: MissingFieldsTarget, field: string): string {
  return t.has(`missingFields.${target}.${field}` as never) ? t(`missingFields.${target}.${field}` as never) : field;
}

/// An item's knowledge status, in the reader's language.
export function useStatusLabel(): (status: KnowledgeStatusLike) => string {
  const t = useTranslations("clients.knowledge");
  return (status) => t(`status.${status}`);
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/// The item's sources, as typed codes, with the register right under the
/// field so nobody has to remember what S4 was.
export function SourcesField({
  options,
  defaultValue,
  status,
  confirmedBefore = false,
}: {
  options: SourceOption[];
  defaultValue?: string;
  status: KnowledgeStatusLike;
  /// The item is confirmed already. On the same sources it stays so (a
  /// person confirmed it by hand), and the form has nothing to warn about.
  confirmedBefore?: boolean;
}) {
  const t = useTranslations("clients.knowledge");
  const [value, setValue] = useState(defaultValue ?? "");
  const [manual, setManual] = useState(false);
  // R14: "מאושר" on Ankora's own documents alone is saved as "לא ודאי".
  // The server does that quietly, so the form says it before saving, not
  // after the person finds the old status back (20.10.2026).
  const secondary = new Set(options.filter((o) => o.secondary).map((o) => o.code));
  const codesOf = (v: string) => [...v.matchAll(/\bS\d+\b/gi)].map((m) => m[0].toUpperCase());
  const codes = codesOf(value);
  const unchanged = codes.slice().sort().join() === codesOf(defaultValue ?? "").sort().join();
  const lowered = status === "CONFIRMED" && codes.length > 0 && codes.every((c) => secondary.has(c)) && !(confirmedBefore && unchanged);
  return (
    <div>
      <Field label={status === "MISSING" ? t("sources.label") : t("sources.labelRequired")}>
        <input name="sources" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} placeholder="S1 08:13, S3" className={INPUT} />
      </Field>
      {lowered && (
        <div className="mt-1.5 rounded-lg border border-app-border bg-app-surface-sunken px-3 py-2 text-xs" data-testid="sources-secondary-only">
          <p className={manual ? "text-app-text-secondary" : "text-app-warning"}>
            {t("sources.secondaryOnly", { count: codes.length, status: t("status.UNCERTAIN") })}
          </p>
          {/* Not every client puts things in writing (20.10.2026). The
              person saving it stands behind it, and the audit log says who. */}
          <label className="mt-1.5 flex items-start gap-2 text-app-text-primary">
            <input type="checkbox" name="manualConfirm" value="1" checked={manual} onChange={(e) => setManual(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-gold" />
            <span>{t("sources.manualConfirm", { status: t("status.CONFIRMED") })}</span>
          </label>
        </div>
      )}
      {options.length === 0 ? (
        <p className="mt-1 text-[11px] text-app-text-tertiary">{t("sources.emptyRegister")}</p>
      ) : (
        // The most recent ones: a long register is read in its own panel.
        <p className="mt-1 text-[11px] text-app-text-tertiary">
          {options
            .slice(-8)
            .map((o) => (o.secondary ? t("sources.optionAnkora", { code: o.code, title: o.title }) : `${o.code} ${o.title}`))
            .join(" · ")}
          {options.length > 8 && " · ..."}
        </p>
      )}
    </div>
  );
}

export function SourceCodes({ sources, options }: { sources: string[]; options: SourceOption[] }) {
  if (sources.length === 0) return null;
  const titles = new Map(options.map((o) => [o.code, o.title]));
  return (
    // The codes read left to right, but the line sits where every other
    // line of the item starts. `dir` on the paragraph itself aligned it to
    // the left edge of the item's text, which is wherever its longest
    // line happens to end (20.10.2026).
    <p className="mt-1 text-[11px] text-app-text-tertiary">
      <span dir="ltr">
        {sources.map((s, i) => (
          <span key={s} title={titles.get(s.split(" ")[0])}>
            {i > 0 && ", "}
            {s}
          </span>
        ))}
      </span>
    </p>
  );
}

export function StatusLine({ status, toResolve }: { status: KnowledgeStatusLike; toResolve: string | null }) {
  const t = useTranslations("clients.knowledge");
  if (status === "CONFIRMED") return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-app-text-secondary">
      <StatusBadge label={t(`status.${status}`)} tone={STATUS_TONE[status]} />
      {toResolve && <span dir="auto">{toResolve}</span>}
    </div>
  );
}

/// Which of the client's legal entities. Shown only once the client has
/// entities: before that there is nothing to choose.
export function EntitySelect({ entities, defaultValue }: { entities: EntityOption[]; defaultValue?: string | null }) {
  const t = useTranslations("clients.knowledge");
  if (entities.length === 0) return null;
  return (
    <Field label={t("entity.label")}>
      <select name="entityId" defaultValue={defaultValue ?? ""} className={INPUT}>
        <option value="">{t("entity.none")}</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Spec 3.1: who keeps an item right, and whether the client sees it. The
// same two fields on every kind of item, so the staff list is given once.
// ---------------------------------------------------------------------------

export type StaffOption = { id: string; name: string };
const StaffContext = createContext<StaffOption[]>([]);

export function useItemStaff(): StaffOption[] {
  return useContext(StaffContext);
}

export function ItemStaffProvider({ staff, children }: { staff: StaffOption[]; children: React.ReactNode }) {
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}

/// The two fields in an item's form. `owner` false for a process, whose
/// form already asks for its owner.
export function ItemExtras({
  existing,
  owner = true,
  disclose = false,
  audience = false,
}: {
  existing?: {
    clientVisible?: boolean;
    ownerId?: string | null;
    doNotDisclose?: string | null;
    externalRefs?: string;
    audience?: Audience;
    audienceUserIds?: string[];
  } | null;
  owner?: boolean;
  /// Spec 3.1, 6.1: "not to tell", for the forms that have no field of their own.
  disclose?: boolean;
  /// Spec 3.1: who sees it, for the forms that have no field of their own.
  audience?: boolean;
}) {
  const t = useTranslations("clients.knowledge");
  const staff = useContext(StaffContext);
  return (
    <div className="grid grid-cols-2 gap-3">
      <input type="hidden" name="itemExtras" value="1" />
      {audience && (
        <>
          <input type="hidden" name="itemAudience" value="1" />
          <AudienceField existing={existing} />
        </>
      )}
      <div className="col-span-2">
        <Field label={t("extras.externalRefs")}>
          <input name="externalRefs" defaultValue={existing?.externalRefs ?? ""} placeholder="RAID-002, HND-014" className={INPUT} dir="ltr" />
        </Field>
      </div>
      {disclose && (
        <div className="col-span-2">
          <input type="hidden" name="itemDisclose" value="1" />
          <Field label={t("extras.doNotDisclose")}>
            <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} placeholder={t("extras.doNotDisclosePlaceholder")} className={INPUT} />
          </Field>
        </div>
      )}
      {owner && (
        <Field label={t("extras.owner")}>
          <select name="itemOwnerId" defaultValue={existing?.ownerId ?? ""} className={INPUT}>
            <option value="">{t("extras.noOwner")}</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-app-text-primary">
        <input type="checkbox" name="clientVisible" defaultChecked={!!existing?.clientVisible} className="h-4 w-4 accent-gold" />
        {t("extras.clientVisible")}
      </label>
    </div>
  );
}

/// The two, as a line on the item. Nothing when neither is set.
/// Spec 3.1: fields of a known item that are still missing, with what
/// would close them. The item's own status stays; the file shows it as
/// weak as its weakest field.
export function MissingFields({
  target,
  existing,
}: {
  target: MissingFieldsTarget;
  existing?: { missingFields?: string[]; missingToResolve?: string | null } | null;
}) {
  const t = useTranslations("clients.knowledge");
  const keys = Object.keys(ITEM_MISSING_FIELDS[target]);
  const [missing, setMissing] = useState<string[]>(existing?.missingFields ?? []);
  return (
    <div data-testid="missing-fields">
      <input type="hidden" name="itemMissing" value={target} />
      <p className="mb-1 text-xs text-app-text-secondary">{t("missing.title")}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {keys.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-xs text-app-text-secondary">
            <input
              type="checkbox"
              name="itemMissingFields"
              value={key}
              checked={missing.includes(key)}
              onChange={(e) => setMissing((m) => (e.target.checked ? [...m, key] : m.filter((x) => x !== key)))}
              className="h-3.5 w-3.5 accent-gold"
            />
            {missingFieldLabel(t, target, key)}
          </label>
        ))}
      </div>
      {missing.length > 0 && (
        <Field label={t("missing.toResolve")}>
          <input name="itemMissingToResolve" required defaultValue={existing?.missingToResolve ?? ""} className={INPUT} />
        </Field>
      )}
    </div>
  );
}

export function ItemTags({
  item,
  disclose = false,
  missingTarget,
}: {
  item: {
    clientVisible?: boolean;
    ownerId?: string | null;
    doNotDisclose?: string | null;
    refs?: string[];
    verifiedAt?: string | null;
    missing?: string | null;
    missingFields?: string[];
    missingToResolve?: string | null;
  };
  disclose?: boolean;
  /// ADR 0006: which fields `missingFields` names, so the line is worded
  /// here in the reader's language. Without it, the server's line is shown.
  missingTarget?: MissingFieldsTarget;
}) {
  const t = useTranslations("clients.knowledge");
  const format = useFormatter();
  const staff = useContext(StaffContext);
  const missingLine = (() => {
    if (!missingTarget) return item.missing ?? null;
    const known = Object.keys(ITEM_MISSING_FIELDS[missingTarget]);
    const fields = (item.missingFields ?? []).filter((f) => known.includes(f));
    if (!fields.length) return null;
    const list = fields.map((f) => missingFieldLabel(t, missingTarget, f)).join(", ");
    return item.missingToResolve ? t("missing.lineWhy", { fields: list, why: item.missingToResolve }) : t("missing.line", { fields: list });
  })();
  const owner = item.ownerId ? staff.find((u) => u.id === item.ownerId)?.name : null;
  const notToTell = disclose ? item.doNotDisclose?.trim() : null;
  const refs = item.refs ?? [];
  if (!item.clientVisible && !owner && !notToTell && refs.length === 0 && !item.verifiedAt && !missingLine) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-app-text-secondary" data-testid="item-tags">
      {refs.map((r) => (
        <span key={r} dir="ltr" className="rounded border border-app-border px-1.5 py-0.5 font-jbmono text-[11px]" data-testid="external-ref">
          {r}
        </span>
      ))}
      {item.verifiedAt && <span>{t("tags.verified", { date: format.dateTime(new Date(item.verifiedAt), { day: "numeric", month: "numeric", year: "numeric" }) })}</span>}
      {missingLine && <span className="w-full text-app-error" data-testid="missing-line">{missingLine}</span>}
      {notToTell && <span className="w-full text-app-error" data-testid="do-not-disclose">{t("tags.doNotTell", { text: notToTell })}</span>}
      {item.clientVisible && <StatusBadge label={t("extras.clientVisible")} tone="green" />}
      {owner && <span>{t("tags.owner", { name: owner })}</span>}
    </div>
  );
}

type Audience = KnowledgeAudienceLike;
const AUDIENCES: Audience[] = ["ALL_STAFF", "ACCOUNT_TEAM", "RESTRICTED"];

/// Spec 3.1: who sees the item. "Restricted" and "account team" name the
/// people on it; whoever saves it is added on the server, so nobody locks
/// themselves out of what they wrote.
export function AudienceField({ existing }: { existing?: { audience?: Audience; audienceUserIds?: string[] } | null }) {
  const t = useTranslations("clients.knowledge");
  const staff = useContext(StaffContext);
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? "ALL_STAFF");
  const chosen = new Set(existing?.audienceUserIds ?? []);
  return (
    <>
      <Field label={t("audience.label")}>
        <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={INPUT}>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {t(`audience.${a}`)}
            </option>
          ))}
        </select>
      </Field>
      {audience !== "ALL_STAFF" && staff.length > 0 && (
        <fieldset className="col-span-2" data-testid="audience-people">
          <input type="hidden" name="audiencePeople" value="1" />
          <legend className={LABEL}>{audience === "RESTRICTED" ? t("audience.restrictedPeople") : t("audience.teamPeople")}</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {staff.map((u) => (
              <label key={u.id} className="flex items-center gap-1.5 text-sm text-app-text-primary">
                <input type="checkbox" name="audienceUserIds" value={u.id} defaultChecked={chosen.has(u.id)} className="h-4 w-4 accent-gold" />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
