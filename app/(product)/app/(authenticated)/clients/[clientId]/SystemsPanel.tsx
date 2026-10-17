"use client";
import { useState } from "react";
import Link from "next/link";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatMinor } from "@/lib/money";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_AUDIENCE_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  BILLING_CYCLE_LABELS,
  SYSTEM_ACCESS_STATUS_LABELS,
  SYSTEM_ACCESS_STATUS_TONE,
  SYSTEM_PERMISSION_LABELS,
  isAccessGap,
  type BillingCycleLike,
  type SystemAccessStatusLike,
  type SystemPermissionLike,
} from "@/lib/system-map";
import { addSystemAccessAction, updateSystemAccessAction, removeSystemAccessAction } from "../system-actions";
import { EntitySelect, Field, INPUT, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption } from "./knowledge-ui";

// Org brain, phase 2: the system map, section 7.1 of the client file
// (claude/org-brain-spec-2026-10-12.md, 3.6).
//
// Read top down, it is the handover's to-do list: systems we are waiting
// for come first, then the ones we have no way into, then the rest. The
// vault keeps the secret; this keeps everything a person needs to know
// before they reach for it.

export type PanelSystem = {
  id: string;
  systemName: string;
  purpose: string | null;
  entityId: string | null;
  entityName: string | null;
  url: string | null;
  accountUsed: string | null;
  ourPermission: SystemPermissionLike;
  accessStatus: SystemAccessStatusLike;
  blocker: string | null;
  clientAdmin: string | null;
  credential: { id: string; systemName: string } | null;
  billingCycle: BillingCycleLike | null;
  billingCostMinor: number | null;
  billingCurrency: string | null;
  cardLast4: string | null;
  invoiceTo: string | null;
  notes: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  audience: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  doNotDisclose: string | null;
  sources: string[];
};

type VaultOption = { id: string; systemName: string };

function money(minor: number, currency: string | null) {
  return currency === "USD" ? `$${(minor / 100).toLocaleString("en-US")}` : formatMinor(minor);
}

function SystemForm({
  clientId,
  sourceOptions,
  vault,
  entities,
  existing,
}: {
  clientId: string;
  sourceOptions: SourceOption[];
  /// Null when this person may not open the vault: no picker at all.
  vault: VaultOption[] | null;
  entities: EntityOption[];
  existing?: PanelSystem;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateSystemAccessAction : addSystemAccessAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.status ?? "CONFIRMED");
  const [access, setAccess] = useState<SystemAccessStatusLike>(existing?.accessStatus ?? "HAS_ACCESS");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label="מערכת *">
        <input name="systemName" required defaultValue={existing?.systemName ?? ""} placeholder="Mercury" className={INPUT} />
      </Field>
      <EntitySelect entities={entities} defaultValue={existing?.entityId} />
      <Field label="למה היא משמשת">
        <input name="purpose" defaultValue={existing?.purpose ?? ""} placeholder="בנק של Inc" className={INPUT} />
      </Field>
      <Field label="כתובת">
        <input name="url" dir="ltr" defaultValue={existing?.url ?? ""} placeholder="app.mercury.com" className={INPUT} />
      </Field>
      <Field label="החשבון שאנחנו עובדים איתו">
        <input name="accountUsed" defaultValue={existing?.accountUsed ?? ""} placeholder="office@client.com" className={INPUT} />
      </Field>
      <p className="-mt-2 text-[11px] text-appNavy/40">בלי סיסמאות. סיסמה נשמרת בכספת.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="מצב הגישה">
          <select name="accessStatus" value={access} onChange={(e) => setAccess(e.target.value as SystemAccessStatusLike)} className={INPUT}>
            {(Object.keys(SYSTEM_ACCESS_STATUS_LABELS) as SystemAccessStatusLike[]).map((s) => (
              <option key={s} value={s}>
                {SYSTEM_ACCESS_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ההרשאה שלנו">
          <select name="ourPermission" defaultValue={existing?.ourPermission ?? "USER"} className={INPUT}>
            {(Object.keys(SYSTEM_PERMISSION_LABELS) as SystemPermissionLike[]).map((p) => (
              <option key={p} value={p}>
                {SYSTEM_PERMISSION_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {isAccessGap(access) && (
        <Field label="מה חוסם">
          <input name="blocker" defaultValue={existing?.blocker ?? ""} placeholder="MFA לטלפון של המנכ״ל" className={INPUT} />
        </Field>
      )}
      <Field label="מי מנהל אותה אצל הלקוח">
        <input name="clientAdmin" defaultValue={existing?.clientAdmin ?? ""} placeholder="המנכ״ל פותח משתמשים ידנית" className={INPUT} />
      </Field>
      {vault && (
        <Field label="רשומה בכספת">
          <select name="credentialId" defaultValue={existing?.credential?.id ?? ""} className={INPUT}>
            <option value="">אין</option>
            {vault.map((v) => (
              <option key={v.id} value={v.id}>
                {v.systemName}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="עלות">
          <input
            name="billingCost"
            dir="ltr"
            inputMode="decimal"
            defaultValue={existing?.billingCostMinor != null ? String(existing.billingCostMinor / 100) : ""}
            className={INPUT}
          />
        </Field>
        <Field label="מטבע">
          <select name="billingCurrency" defaultValue={existing?.billingCurrency ?? "USD"} className={INPUT}>
            <option value="USD">$</option>
            <option value="ILS">₪</option>
          </select>
        </Field>
        <Field label="מחזור">
          <select name="billingCycle" defaultValue={existing?.billingCycle ?? "MONTHLY"} className={INPUT}>
            <option value="MONTHLY">חודשי</option>
            <option value="ANNUAL">שנתי</option>
            <option value="OTHER">אחר</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="4 ספרות של הכרטיס">
          <input name="cardLast4" dir="ltr" inputMode="numeric" maxLength={4} defaultValue={existing?.cardLast4 ?? ""} className={INPUT} />
        </Field>
        <Field label="לאן מגיעה החשבונית">
          <input name="invoiceTo" dir="ltr" defaultValue={existing?.invoiceTo ?? ""} placeholder="billing@client.com" className={INPUT} />
        </Field>
      </div>
      <Field label="הערות">
        <textarea name="notes" rows={2} defaultValue={existing?.notes ?? ""} className={INPUT} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="סטטוס">
          <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
            <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
            <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
            <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
          </select>
        </Field>
        <Field label="מי רואה">
          <select name="audience" defaultValue={existing?.audience ?? "ALL_STAFF"} className={INPUT}>
            {(Object.keys(KNOWLEDGE_AUDIENCE_LABELS) as (keyof typeof KNOWLEDGE_AUDIENCE_LABELS)[]).map((a) => (
              <option key={a} value={a}>
                {KNOWLEDGE_AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      <Field label="למי אסור לספר">
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה למפה"}
      </button>
    </form>
  );
}

export function SystemsPanel({
  clientId,
  systems,
  sourceOptions,
  vault,
  entities,
  ruleWarnings = {},
}: {
  clientId: string;
  systems: PanelSystem[];
  sourceOptions: SourceOption[];
  vault: VaultOption[] | null;
  entities: EntityOption[];
  /// Where a client's rule disagrees with the system (R16), by system id.
  ruleWarnings?: Record<string, string[]>;
}) {
  const { showToast } = useToast();
  const gaps = systems.filter((s) => isAccessGap(s.accessStatus)).length;

  async function remove(s: PanelSystem) {
    const result = await removeSystemAccessAction(s.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר מהמפה", description: s.systemName });
  }

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-appNavy">
          מפת מערכות ({systems.length})
          {gaps > 0 && <span className="ms-2 text-xs font-normal text-warning">{gaps} בלי גישה עדיין</span>}
        </h2>
        <Drawer triggerLabel="+ מערכת" title="מערכת במפה" variant="link">
          <SystemForm clientId={clientId} sourceOptions={sourceOptions} vault={vault} entities={entities} />
        </Drawer>
      </div>
      {systems.length === 0 ? (
        <p className="mt-2 text-sm text-appNavy/50">אין עדיין מערכות במפה. גם מערכת שאין לנו אליה גישה נכנסת לכאן.</p>
      ) : (
        <ul className="mt-4 divide-y divide-lineDark">
          {systems.map((s) => (
            <li key={s.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-appNavy">{s.systemName}</p>
                    <StatusBadge label={SYSTEM_ACCESS_STATUS_LABELS[s.accessStatus]} tone={SYSTEM_ACCESS_STATUS_TONE[s.accessStatus]} />
                  </div>
                  <p className="text-xs text-appNavy/60">
                    {[s.purpose, s.entityName, s.ourPermission !== "NONE" ? `הרשאה: ${SYSTEM_PERMISSION_LABELS[s.ourPermission]}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {s.accountUsed && (
                    <p className="mt-1 text-xs text-appNavy/70">
                      חשבון: <span dir="ltr">{s.accountUsed}</span>
                    </p>
                  )}
                  {s.blocker && <p className="mt-1 text-xs text-warning">חוסם: {s.blocker}</p>}
                  {s.clientAdmin && <p className="mt-1 text-xs text-appNavy/60">מנהל אצל הלקוח: {s.clientAdmin}</p>}
                  {s.billingCostMinor !== null && (
                    <p className="mt-1 text-xs text-appNavy/70">
                      {money(s.billingCostMinor, s.billingCurrency)} {s.billingCycle ? BILLING_CYCLE_LABELS[s.billingCycle] : ""}
                      {s.cardLast4 && <span dir="ltr"> · ****{s.cardLast4}</span>}
                      {s.invoiceTo && (
                        <>
                          {" "}
                          · חשבונית ל-<span dir="ltr">{s.invoiceTo}</span>
                        </>
                      )}
                    </p>
                  )}
                  {s.notes && <p className="mt-1 text-xs text-appNavy/70">{s.notes}</p>}
                  {s.credential && (
                    <p className="mt-1 text-xs">
                      <Link href={`/app/credentials?clientId=${clientId}`} className="text-gold-dim hover:underline">
                        בכספת: {s.credential.systemName}
                      </Link>
                    </p>
                  )}
                  {s.doNotDisclose && <p className="mt-1 text-xs text-red-700">לא לספר: {s.doNotDisclose}</p>}
                  {(ruleWarnings[s.id] ?? []).map((w, i) => (
                    <p key={i} className="mt-1 text-xs text-warning">
                      {w}
                    </p>
                  ))}
                  <StatusLine status={s.status} toResolve={s.toResolve} />
                  <SourceCodes sources={s.sources} options={sourceOptions} />
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <Drawer triggerLabel="עריכה" title="עריכת מערכת" variant="link">
                    <SystemForm clientId={clientId} sourceOptions={sourceOptions} vault={vault} entities={entities} existing={s} />
                  </Drawer>
                  <button type="button" onClick={() => remove(s)} className="text-appNavy/50 hover:text-red-600">
                    הסרה
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
