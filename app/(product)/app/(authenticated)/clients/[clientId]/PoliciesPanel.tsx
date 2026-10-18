"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  NEEDS_INTERIM,
  POLICY_KINDS,
  POLICY_KIND_HINTS,
  POLICY_KIND_LABELS,
  POLICY_STATUS_LABELS,
  type PolicyKindLike,
  type PolicyStatusLike,
} from "@/lib/client-policies";
import {
  addPolicyAction,
  approveExceptionAction,
  approvePolicyAction,
  rejectExceptionAction,
  removePolicyAction,
  requestExceptionAction,
  retirePolicyAction,
  setRuleApproversAction,
  updatePolicyAction,
  withdrawExceptionAction,
} from "../policy-actions";
import { Field, INPUT, SourceCodes, SourcesField, StatusLine, type SourceOption, ItemExtras, ItemTags } from "./knowledge-ui";
import { PolicyParamsFields } from "./PolicyParamsFields";
import { kindTakesParams, type PolicyParams } from "@/lib/policy-params";

// Org brain, phase 3: the client's own rules, sections 6 and 14 of the
// client file (claude/org-brain-spec-2026-10-12.md, 3.11).
//
// Anyone on the client writes a rule down; it is "proposed" until a
// manager approves it. While proposed, its interim rule is what applies,
// and the screen says so next to it, so nobody acts on a permission the
// client has not confirmed.

export type PanelPolicy = {
  clientVisible?: boolean;
  ownerId?: string | null;
  id: string;
  kind: PolicyKindLike;
  status: PolicyStatusLike;
  version: number;
  title: string;
  statement: string;
  rationale: string | null;
  interimStatement: string | null;
  params: PolicyParams;
  interimParams: PolicyParams;
  /// What the server checks now, in a line; null when nothing.
  checked: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  knowledgeStatus: KnowledgeStatusLike;
  toResolve: string | null;
  sources: string[];
};

export type PanelException = {
  id: string;
  policyId: string;
  what: string;
  reason: string;
  validUntil: string;
  status: "REQUESTED" | "APPROVED";
  requestedById: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
};

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { timeZone: "UTC" });
}

function ExceptionForm({ clientId, policy, maxDays }: { clientId: string; policy: PanelPolicy; maxDays: number }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(requestExceptionAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="policyId" value={policy.id} />
      <p className="text-xs text-appNavy/60">
        הכלל: {policy.statement}
      </p>
      <Field label="מה עושים אחרת *">
        <textarea name="what" required rows={2} placeholder="לשלוח לאיילה את חשבוניות Inc של אוקטובר" className={INPUT} />
      </Field>
      <Field label="למה *">
        <input name="reason" required placeholder="שני בחופשה, והתשלום ב-25 לחודש" className={INPUT} />
      </Field>
      <Field label="עד (כולל) *">
        <input name="validUntil" type="date" required className={INPUT} />
      </Field>
      <p className="-mt-2 text-[11px] text-appNavy/50">עד {maxDays} יום. לתקופה ארוכה יותר משנים את הכלל עצמו.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שולח..." : "שליחת הבקשה"}
      </button>
    </form>
  );
}

function RejectExceptionForm({ clientId, exception }: { clientId: string; exception: PanelException }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectExceptionAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={exception.id} />
      <p className="text-sm text-appNavy">{exception.what}</p>
      <Field label="למה לא, בשורה אחת *">
        <input name="note" required className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-lineDark px-5 py-2.5 text-sm font-medium text-appNavy disabled:opacity-50">
        {pending ? "שומר..." : "דחיית הבקשה"}
      </button>
    </form>
  );
}

function ApproversForm({ clientId, staff, selected }: { clientId: string; staff: { id: string; name: string }[]; selected: string[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setRuleApproversAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <p className="text-xs text-appNavy/60">
        רק כשהלקוח קבע מי מאשר. בלי בחירה, מאשר כל מי שקיבל את ההרשאה &quot;אישור חריגות ומידע רגיש&quot; בדף המשתמש.
      </p>
      <fieldset className="flex flex-col gap-1.5">
        {staff.map((u) => (
          <label key={u.id} className="flex items-center gap-1.5 text-sm text-appNavy">
            <input type="checkbox" name="approver" value={u.id} defaultChecked={selected.includes(u.id)} className="h-4 w-4 accent-gold" />
            {u.name}
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "שמירה"}
      </button>
    </form>
  );
}

const STATUS_TONE: Record<PolicyStatusLike, "green" | "amber" | "gray"> = { ACTIVE: "green", PROPOSED: "amber", RETIRED: "gray" };

function PolicyForm({
  clientId,
  sourceOptions,
  entities,
  existing,
}: {
  clientId: string;
  sourceOptions: SourceOption[];
  entities: { id: string; name: string }[];
  existing?: PanelPolicy;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updatePolicyAction : addPolicyAction, close);
  const [kind, setKind] = useState<PolicyKindLike>(existing?.kind ?? "INFO");
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.knowledgeStatus ?? "CONFIRMED");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {existing?.status === "ACTIVE" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          הכלל בתוקף. שינוי בשם, בסוג, בנוסח או במה שנבדק מחזיר אותו ל&quot;מוצע&quot;, ומנהל צריך לאשר אותו שוב.
        </p>
      )}
      <Field label="סוג הכלל *">
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PolicyKindLike)} className={INPUT}>
          {POLICY_KINDS.map((k) => (
            <option key={k} value={k}>
              {POLICY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
      <p className="-mt-2 text-[11px] text-appNavy/50">{POLICY_KIND_HINTS[kind]}</p>
      <Field label="שם הכלל *">
        <input name="title" required defaultValue={existing?.title ?? ""} placeholder="פגישות הנהלה" className={INPUT} />
      </Field>
      <Field label="הכלל *">
        <textarea name="statement" required rows={3} defaultValue={existing?.statement ?? ""} placeholder="רושמים נושאים בלבד, בלי ציטוטים ובלי פרטים" className={INPUT} />
      </Field>
      <Field label={NEEDS_INTERIM.includes(kind) ? "עד שיאושר *" : "עד שיאושר"}>
        <textarea
          name="interimStatement"
          rows={2}
          required={NEEDS_INTERIM.includes(kind)}
          defaultValue={existing?.interimStatement ?? ""}
          placeholder="כל הוצאה עוברת לאורן"
          className={INPUT}
        />
      </Field>
      <p className="-mt-2 text-[11px] text-appNavy/50">הכלל הזהיר שחל עד שמנהל מאשר. בלי כלל ביניים, הכלל חל כפי שהוא כתוב.</p>
      <PolicyParamsFields
        key={kind}
        kind={kind}
        initial={existing?.kind === kind ? existing.params : undefined}
        initialInterim={existing?.kind === kind ? existing.interimParams : undefined}
        entities={entities}
      />
      <Field label="למה">
        <input name="rationale" defaultValue={existing?.rationale ?? ""} className={INPUT} />
      </Field>
      <Field label="מה ידוע על הכלל">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} />
      <ItemExtras existing={existing} />
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

function RetireForm({ clientId, policy }: { clientId: string; policy: PanelPolicy }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(retirePolicyAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={policy.id} />
      <p className="text-sm text-appNavy">{policy.title}</p>
      <Field label="למה מבטלים, בשורה אחת *">
        <input name="reason" required placeholder="אורן ביטל את המגבלה בפגישה מ-20.10" className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-lineDark px-5 py-2.5 text-sm font-medium text-appNavy disabled:opacity-50">
        {pending ? "שומר..." : "ביטול הכלל"}
      </button>
    </form>
  );
}

export function PoliciesPanel({
  clientId,
  policies,
  sourceOptions,
  canApprove,
  exceptions,
  approvers,
  clientApproverIds,
  staff,
  canDecideExceptions,
  viewerId,
  maxExceptionDays,
  entities,
}: {
  clientId: string;
  policies: PanelPolicy[];
  sourceOptions: SourceOption[];
  /// Approves and retires rules, and names the client's approvers: a manager.
  canApprove: boolean;
  exceptions: PanelException[];
  /// Who decides exceptions and sensitive items for this client, now.
  approvers: { id: string; name: string }[];
  clientApproverIds: string[];
  staff: { id: string; name: string }[];
  canDecideExceptions: boolean;
  viewerId: string;
  maxExceptionDays: number;
  entities: { id: string; name: string }[];
}) {
  const { showToast } = useToast();
  const live = policies.filter((p) => p.status !== "RETIRED");
  const retired = policies.filter((p) => p.status === "RETIRED");

  async function approve(p: PanelPolicy) {
    const r = await approvePolicyAction(p.id, clientId);
    if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
    else showToast({ tone: "success", title: "הכלל בתוקף", description: p.title });
  }
  async function decide(e: PanelException) {
    const r = await approveExceptionAction(e.id, clientId);
    if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
    else showToast({ tone: "success", title: "החריגה אושרה", description: e.what.slice(0, 80) });
  }
  async function withdraw(e: PanelException) {
    const r = await withdrawExceptionAction(e.id, clientId);
    if (r.error) showToast({ tone: "error", title: "המשיכה נכשלה", description: r.error });
    else showToast({ tone: "info", title: "הבקשה נמשכה", description: e.what.slice(0, 80) });
  }
  async function remove(p: PanelPolicy) {
    const r = await removePolicyAction(p.id, clientId);
    if (r.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: r.error });
    else showToast({ tone: "info", title: "הוסר מהתיק", description: p.title });
  }

  return (
    <div id="rules" className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-appNavy">כללים של הלקוח ({live.length})</h2>
        <Drawer triggerLabel="+ כלל" title="כלל של הלקוח" variant="link">
          <PolicyForm clientId={clientId} sourceOptions={sourceOptions} entities={entities} />
        </Drawer>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-appNavy/50">
        <span>
          חריגות ומידע רגיש מאשר/ת: {approvers.length ? approvers.map((a) => a.name).join(", ") : "עוד אין מי שמאשר. נותנים הרשאה בדף המשתמש."}
          {clientApproverIds.length > 0 && " (לפי מה שהלקוח קבע)"}
        </span>
        {canApprove && (
          <Drawer triggerLabel="שינוי" title="מי מאשר אצל הלקוח" variant="link">
            <ApproversForm clientId={clientId} staff={staff} selected={clientApproverIds} />
          </Drawer>
        )}
      </p>
      {live.length === 0 ? (
        <p className="mt-2 text-sm text-appNavy/50">
          אין עדיין כללים. מה מותר ומה אסור אצל הלקוח, מי מאשר, מה לא מספרים למי, ומה לא נכנס לתיק בכלל.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-lineDark">
          {live.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-appNavy">{p.title}</p>
                  <StatusBadge label={POLICY_STATUS_LABELS[p.status]} tone={STATUS_TONE[p.status]} />
                  <span className="text-[11px] text-appNavy/50">
                    {POLICY_KIND_LABELS[p.kind]}
                    {p.version > 1 && ` · גרסה ${p.version}`}
                  </span>
                </div>
                {p.status === "PROPOSED" && p.interimStatement ? (
                  <>
                    <p className="mt-1 text-xs text-appNavy/80">
                      <span className="font-medium">עד שיאושר: </span>
                      {p.interimStatement}
                    </p>
                    <p className="mt-0.5 text-xs text-appNavy/55">הכלל המוצע: {p.statement}</p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-appNavy/80">{p.statement}</p>
                )}
                {p.rationale && <p className="mt-0.5 text-xs text-appNavy/55">למה: {p.rationale}</p>}
                {p.checked ? (
                  <p className="mt-0.5 text-xs text-appNavy/70">
                    <span className="font-medium">נבדק מול הנהלים: </span>
                    {p.checked}
                  </p>
                ) : (
                  kindTakesParams(p.kind) && <p className="mt-0.5 text-[11px] text-appNavy/45">טקסט בלבד: השרת לא בודק את הכלל הזה.</p>
                )}
                {p.status === "ACTIVE" && p.approvedByName && (
                  <p className="mt-0.5 text-[11px] text-appNavy/45">
                    אושר על ידי {p.approvedByName}
                    {p.approvedAt && `, ${new Date(p.approvedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`}
                  </p>
                )}
                <StatusLine status={p.knowledgeStatus} toResolve={p.toResolve} />
                <ItemTags item={p} />
                <SourceCodes sources={p.sources} options={sourceOptions} />
                {exceptions
                  .filter((e) => e.policyId === p.id)
                  .map((e) => (
                    <div key={e.id} className="mt-2 rounded-lg border border-lineDark bg-appNavy/[0.02] px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label={e.status === "APPROVED" ? `חריגה עד ${dayLabel(e.validUntil)}` : "בקשה לחריגה"} tone={e.status === "APPROVED" ? "gray" : "amber"} />
                        <span className="text-appNavy">{e.what}</span>
                      </div>
                      <p className="mt-1 text-appNavy/55">
                        למה: {e.reason}
                        {e.status === "REQUESTED" && ` · עד ${dayLabel(e.validUntil)}`}
                        {e.requestedByName && ` · ביקש/ה ${e.requestedByName}`}
                        {e.decidedByName && ` · אישר/ה ${e.decidedByName}`}
                        {e.decisionNote && ` · ${e.decisionNote}`}
                      </p>
                      {e.status === "REQUESTED" && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-3">
                          {canDecideExceptions && (
                            <>
                              <button type="button" onClick={() => decide(e)} className="font-medium text-gold-dim hover:underline">
                                אישור החריגה
                              </button>
                              <Drawer triggerLabel="דחיית החריגה" title="דחיית בקשה לחריגה" variant="link">
                                <RejectExceptionForm clientId={clientId} exception={e} />
                              </Drawer>
                            </>
                          )}
                          {e.requestedById === viewerId && (
                            <button type="button" onClick={() => withdraw(e)} className="text-appNavy/50 hover:text-appNavy">
                              משיכת הבקשה
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {canApprove && p.status === "PROPOSED" && (
                  <button type="button" onClick={() => approve(p)} className="font-medium text-gold-dim hover:underline">
                    אישור הכלל
                  </button>
                )}
                <Drawer triggerLabel="עריכה" title={`עריכה: ${p.title}`} variant="link">
                  <PolicyForm clientId={clientId} sourceOptions={sourceOptions} entities={entities} existing={p} />
                </Drawer>
                <Drawer triggerLabel="בקשת חריגה" title={`בקשת חריגה: ${p.title}`} variant="link">
                  <ExceptionForm clientId={clientId} policy={p} maxDays={maxExceptionDays} />
                </Drawer>
                {canApprove && (
                  <Drawer triggerLabel="ביטול" title={`ביטול: ${p.title}`} variant="link">
                    <RetireForm clientId={clientId} policy={p} />
                  </Drawer>
                )}
                {p.status === "PROPOSED" && (
                  <button type="button" onClick={() => remove(p)} className="text-appNavy/50 hover:text-red-600">
                    הסרה
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {retired.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-appNavy/50">כללים שבוטלו ({retired.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {retired.map((p) => (
              <li key={p.id} className="text-xs text-appNavy/50">
                {p.title}: {p.statement}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/// The client's disclosure rules, above everything else on the client
/// screen: the one thing a person must know before saying a word.
export function DisclosureBanner({ rules }: { rules: { id: string; title: string; text: string; proposed: boolean }[] }) {
  if (rules.length === 0) return null;
  return (
    <div role="note" className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
      <p className="text-sm font-medium text-amber-900">לפני שמדברים עם מישהו אצל הלקוח</p>
      <ul className="mt-1.5 space-y-1">
        {rules.map((r) => (
          <li key={r.id} className="text-xs text-amber-900">
            <span className="font-medium">{r.title}: </span>
            {r.text}
            {r.proposed && <span className="text-amber-800/70"> (מוצע)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
