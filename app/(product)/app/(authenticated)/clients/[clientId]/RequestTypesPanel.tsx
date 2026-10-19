"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import { addRequestTypeAction, updateRequestTypeAction, removeRequestTypeAction } from "../file-text-actions";
import { EntitySelect, Field, INPUT, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption, ItemExtras, ItemTags } from "./knowledge-ui";

// Org brain, phase 2: request types and how they are answered, section
// 7.5 of the client file (claude/org-brain-spec-2026-10-12.md, 3.7).

export type PanelRequestType = {
  clientVisible?: boolean;
  doNotDisclose?: string | null;
  ownerId?: string | null;
  id: string;
  title: string;
  fromWho: string | null;
  arrivesVia: string | null;
  handling: string;
  routeToContactIds: string[];
  routeToNames: string[];
  entityId: string | null;
  entityName: string | null;
  processId: string | null;
  /// "P6 נסיעת עובד", or null when there is none or this person may not
  /// see it.
  processName: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  sources: string[];
};

type ContactOption = { id: string; name: string };
type ProcessOption = { id: string; name: string };

function RequestTypeForm({
  clientId,
  contacts,
  entities,
  processes,
  sourceOptions,
  existing,
}: {
  clientId: string;
  contacts: ContactOption[];
  entities: EntityOption[];
  processes: ProcessOption[];
  sourceOptions: SourceOption[];
  existing?: PanelRequestType;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateRequestTypeAction : addRequestTypeAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.status ?? "CONFIRMED");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label="סוג הפנייה *">
        <input name="title" required defaultValue={existing?.title ?? ""} placeholder="חשבונית Inc" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ממי">
          <input name="fromWho" defaultValue={existing?.fromWho ?? ""} placeholder="ספק" className={INPUT} />
        </Field>
        <Field label="מגיעה דרך">
          <input name="arrivesVia" defaultValue={existing?.arrivesVia ?? ""} placeholder="billing-us" className={INPUT} />
        </Field>
      </div>
      <Field label="איך עונים ולאן מעבירים *">
        <textarea name="handling" required rows={3} defaultValue={existing?.handling ?? ""} placeholder="לשני ולג'נן, לא לאיילה" className={INPUT} />
      </Field>
      {contacts.length > 0 && (
        <fieldset>
          <legend className="block text-xs font-medium text-app-text-secondary">למי מפנים</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm text-app-text-primary">
                <input type="checkbox" name="routeTo" value={c.id} defaultChecked={existing?.routeToContactIds.includes(c.id)} className="h-4 w-4 accent-gold" />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <EntitySelect entities={entities} defaultValue={existing?.entityId} />
      {processes.length > 0 && (
        <Field label="מפעיל תהליך">
          <select name="processId" defaultValue={existing?.processId ?? ""} className={INPUT}>
            <option value="">לא מפעיל תהליך</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="סטטוס">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} />
      <ItemExtras existing={existing} disclose />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה לתיק"}
      </button>
    </form>
  );
}

export function RequestTypesPanel({
  clientId,
  requestTypes,
  contacts,
  entities,
  processes = [],
  sourceOptions,
  ruleWarnings = {},
}: {
  clientId: string;
  requestTypes: PanelRequestType[];
  contacts: ContactOption[];
  entities: EntityOption[];
  /// The client's processes this person may see, for "מפעיל תהליך".
  processes?: ProcessOption[];
  sourceOptions: SourceOption[];
  /// Where a client's separation rule disagrees with the routing (R8).
  ruleWarnings?: Record<string, string[]>;
}) {
  const { showToast } = useToast();
  async function remove(r: PanelRequestType) {
    const result = await removeRequestTypeAction(r.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר מהתיק", description: r.title });
  }
  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">סוגי פניות ודרכי מענה ({requestTypes.length})</h2>
        <Drawer triggerLabel="+ סוג פנייה" title="סוג פנייה" variant="link">
          <RequestTypeForm clientId={clientId} contacts={contacts} entities={entities} processes={processes} sourceOptions={sourceOptions} />
        </Drawer>
      </div>
      {requestTypes.length === 0 ? (
        <p className="mt-2 text-sm text-app-text-tertiary">אין עדיין סוגי פניות. מה מגיע, ממי, ואיך עונים: מה שמנהל תפעול חדש צריך ביום הראשון.</p>
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {requestTypes.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-app-text-primary">{r.title}</p>
                <p className="text-xs text-app-text-secondary">{[r.fromWho ? `מ: ${r.fromWho}` : null, r.arrivesVia ? `דרך: ${r.arrivesVia}` : null, r.entityName].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 text-xs text-app-text-primary">{r.handling}</p>
                {r.routeToNames.length > 0 && <p className="mt-1 text-xs text-app-text-secondary">מפנים ל: {r.routeToNames.join(", ")}</p>}
                {r.processName && <p className="mt-1 text-xs text-app-text-secondary">מפעיל: {r.processName}</p>}
                {(ruleWarnings[r.id] ?? []).map((w, i) => (
                  <p key={i} className="mt-1 text-xs text-app-error">
                    {w}
                  </p>
                ))}
                <StatusLine status={r.status} toResolve={r.toResolve} />
                <ItemTags item={r} disclose />
                <SourceCodes sources={r.sources} options={sourceOptions} />
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                <Drawer triggerLabel="עריכה" title={`עריכה: ${r.title}`} variant="link">
                  <RequestTypeForm clientId={clientId} contacts={contacts} entities={entities} processes={processes} sourceOptions={sourceOptions} existing={r} />
                </Drawer>
                <button type="button" onClick={() => remove(r)} className="text-app-text-tertiary hover:text-app-error">
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
