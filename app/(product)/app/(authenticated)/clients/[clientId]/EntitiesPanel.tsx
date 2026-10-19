"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import { addClientEntityAction, updateClientEntityAction, removeClientEntityAction } from "../entity-actions";
import { Field, INPUT, SourceCodes, SourcesField, StatusLine, type SourceOption, ItemExtras, ItemTags } from "./knowledge-ui";

// Org brain, phase 2: the client's legal entities, section 1 of the client
// file (claude/org-brain-spec-2026-10-12.md, 3.3).
//
// A detail nobody has yet is marked missing, field by field, instead of
// being left blank: a blank says nothing, "missing" says somebody should
// ask. The entity then reads as missing too, until it is filled.

export type PanelEntity = {
  /// When a person last confirmed it, as ISO.
  verifiedAt?: string | null;
  /// Spec 3.1: the team's refs, as form text and as labels.
  externalRefs?: string;
  refs?: string[];
  audience?: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  audienceUserIds?: string[];
  clientVisible?: boolean;
  doNotDisclose?: string | null;
  ownerId?: string | null;
  id: string;
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  country: string | null;
  currency: string | null;
  billingAddress: string | null;
  parentId: string | null;
  parentName: string | null;
  missingFields: string[];
  missingToResolve: string | null;
  status: KnowledgeStatusLike;
  ownStatus: KnowledgeStatusLike;
  toResolve: string | null;
  sources: string[];
};

const FIELD_LABELS: Record<string, string> = {
  legalName: "שם משפטי",
  registrationNumber: "מספר רישום",
  country: "מדינה",
  currency: "מטבע",
  billingAddress: "כתובת לחיוב",
};

function MissingToggle({ field, missing, onChange }: { field: string; missing: boolean; onChange: (field: string, on: boolean) => void }) {
  return (
    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-appNavy/50">
      <input
        type="checkbox"
        name="missingFields"
        value={field}
        checked={missing}
        onChange={(e) => onChange(field, e.target.checked)}
        className="h-3.5 w-3.5 accent-gold"
      />
      חסר
    </label>
  );
}

function EntityForm({
  clientId,
  sourceOptions,
  others,
  existing,
}: {
  clientId: string;
  sourceOptions: SourceOption[];
  others: { id: string; name: string }[];
  existing?: PanelEntity;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateClientEntityAction : addClientEntityAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.ownStatus ?? "CONFIRMED");
  const [missing, setMissing] = useState<string[]>(existing?.missingFields ?? []);
  const toggle = (f: string, on: boolean) => setMissing((m) => (on ? [...m, f] : m.filter((x) => x !== f)));

  const text = (name: keyof typeof FIELD_LABELS, props: { placeholder?: string; dir?: "ltr" } = {}) => (
    <div>
      <Field label={FIELD_LABELS[name]}>
        <input
          name={name}
          disabled={missing.includes(name)}
          defaultValue={(existing?.[name as keyof PanelEntity] as string | null) ?? ""}
          className={`${INPUT} disabled:bg-appNavy/5`}
          {...props}
        />
      </Field>
      <MissingToggle field={name} missing={missing.includes(name)} onChange={toggle} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="שם קצר *">
          <input name="name" required defaultValue={existing?.name ?? ""} placeholder="Inc" className={INPUT} />
        </Field>
        <Field label="ישות אם">
          <select name="parentId" defaultValue={existing?.parentId ?? ""} className={INPUT}>
            <option value="">אין</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {text("legalName", { placeholder: "NUX.AI Ltd" })}
      <div className="grid grid-cols-2 gap-3">
        {text("registrationNumber", { dir: "ltr" })}
        {text("country", { placeholder: "IL", dir: "ltr" })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {text("currency", { placeholder: "ILS", dir: "ltr" })}
        {text("billingAddress")}
      </div>
      {missing.length > 0 && (
        <Field label="מה יסגור את השדות החסרים *">
          <input name="missingToResolve" required defaultValue={existing?.missingToResolve ?? ""} placeholder="לבקש מהמנכ״ל את תעודת ההתאגדות" className={INPUT} />
        </Field>
      )}
      <Field label="סטטוס הישות">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} />
      <ItemExtras existing={existing} disclose audience />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה לתיק"}
      </button>
    </form>
  );
}

export function EntitiesPanel({ clientId, entities, sourceOptions }: { clientId: string; entities: PanelEntity[]; sourceOptions: SourceOption[] }) {
  const { showToast } = useToast();

  async function remove(e: PanelEntity) {
    const result = await removeClientEntityAction(e.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר מהתיק", description: e.name });
  }

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-appNavy">ישויות משפטיות ({entities.length})</h2>
        <Drawer triggerLabel="+ ישות" title="ישות משפטית" variant="link">
          <EntityForm clientId={clientId} sourceOptions={sourceOptions} others={entities.map((e) => ({ id: e.id, name: e.name }))} />
        </Drawer>
      </div>
      {entities.length === 0 ? (
        <p className="mt-2 text-sm text-appNavy/50">אין עדיין ישויות. ללקוח עם יותר מישות אחת, אנשים ומערכות משויכים לישות הנכונה.</p>
      ) : (
        <ul className="mt-4 divide-y divide-lineDark">
          {entities.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-appNavy">
                  {e.name}
                  {e.legalName && <span className="ms-2 text-xs font-normal text-appNavy/60">{e.legalName}</span>}
                </p>
                <p className="text-xs text-appNavy/60">
                  {[
                    e.registrationNumber ? <span key="r" dir="ltr">{e.registrationNumber}</span> : null,
                    e.country,
                    e.currency,
                    e.parentName ? `בת של ${e.parentName}` : null,
                  ]
                    .filter(Boolean)
                    .map((x, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        {x}
                      </span>
                    ))}
                </p>
                {e.billingAddress && <p className="mt-1 text-xs text-appNavy/70">{e.billingAddress}</p>}
                {e.missingFields.length > 0 && (
                  <p className="mt-1 text-xs text-error">
                    חסר: {e.missingFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
                    {e.missingToResolve && <span className="text-appNavy/60"> · {e.missingToResolve}</span>}
                  </p>
                )}
                {e.ownStatus !== "CONFIRMED" && <StatusLine status={e.ownStatus} toResolve={e.toResolve} />}
                <ItemTags item={e} disclose />
                <SourceCodes sources={e.sources} options={sourceOptions} />
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                <Drawer triggerLabel="עריכה" title={`עריכה: ${e.name}`} variant="link">
                  <EntityForm
                    clientId={clientId}
                    sourceOptions={sourceOptions}
                    others={entities.filter((o) => o.id !== e.id).map((o) => ({ id: o.id, name: o.name }))}
                    existing={e}
                  />
                </Drawer>
                <button type="button" onClick={() => remove(e)} className="text-appNavy/50 hover:text-red-600">
                  הסרה
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
