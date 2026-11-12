"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { KnowledgeStatusLike } from "@/lib/knowledge";
import { NEEDS_INTERIM, POLICY_KINDS, type PolicyKindLike, type PolicyStatusLike } from "@/lib/client-policies";
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
import { formatAmount, hasParams, kindTakesParams, paramsInForce, type PolicyParams } from "@/lib/policy-params";
import type { ActionTag } from "@/lib/process-rules";

// Org brain, phase 3: the client's own rules, sections 6 and 14 of the
// client file (claude/org-brain-spec-2026-10-12.md, 3.11).
//
// Anyone on the client writes a rule down; it is "proposed" until a
// manager approves it. While proposed, its interim rule is what applies,
// and the screen says so next to it, so nobody acts on a permission the
// client has not confirmed.

export type PanelPolicy = {
  /// Spec 3.11: what it said before, newest first.
  history?: { version: number; title: string; statement: string; interimStatement: string | null; checked: string | null; approvedByName: string | null; approvedAt: string | null; until: string | null }[];
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
  kind: PolicyKindLike;
  status: PolicyStatusLike;
  version: number;
  title: string;
  statement: string;
  rationale: string | null;
  interimStatement: string | null;
  params: PolicyParams;
  interimParams: PolicyParams;
  /// Spec 3.11: YYYY-MM-DD, and the two as a line.
  effectiveFrom?: string | null;
  reviewBy?: string | null;
  datesLine?: string | null;
  reviewDue?: boolean;
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

type PoliciesT = ReturnType<typeof useTranslations<"clients.policies">>;
type Formatter = ReturnType<typeof useFormatter>;

const NUMERIC_DAY = { day: "numeric", month: "numeric", year: "numeric" } as const;

/// A date-only value (UTC midnight), as the reader writes dates.
function dayLabel(format: Formatter, iso: string) {
  return format.dateTime(new Date(iso), { ...NUMERIC_DAY, timeZone: "UTC" });
}

/// What the server checks in the rule, in a line (lib/policy-params.ts
/// paramsSummary words the same for the client file and Claude).
function checkedLine(t: PoliciesT, kind: PolicyKindLike, p: PolicyParams, entityName: (id: string) => string): string | null {
  if (!hasParams(p)) return null;
  const on = (tags?: ActionTag[]) => (tags?.length ? tags.map((x) => t(`params.actionTags.${x}`)).join(", ") : null);
  const withEntity = (line: string) => (p.entityId ? `${line} ${t("checked.entityOnly", { entity: entityName(p.entityId) })}` : line);
  switch (kind) {
    case "THRESHOLD":
      return p.amountMinor !== undefined && p.currency
        ? withEntity(t("checked.threshold", { tags: on(p.appliesToTags) ?? t("checked.thresholdDefaultTags"), amount: formatAmount(p.amountMinor, p.currency) }))
        : null;
    case "APPROVAL_REQUIRED":
      return withEntity(t("checked.approval", { tags: on(p.appliesToTags) ?? "" }));
    case "FORBIDDEN":
      return withEntity(t("checked.forbidden", { tags: on(p.appliesToTags) ?? "" }));
    case "REQUIRED_STEP":
      return withEntity(
        p.appliesToTags?.length ? t("checked.requiredStepWith", { tags: on(p.appliesToTags)!, text: p.mustInclude ?? "" }) : t("checked.requiredStep", { text: p.mustInclude ?? "" })
      );
    case "TIMING":
      return withEntity(t("checked.timing", { tags: on(p.appliesToTags) ?? "", days: String(p.leadBusinessDays ?? "") }));
    case "COMMUNICATION": {
      const parts = [
        p.channels?.length
          ? t("checked.channels", { tags: on(p.appliesToTags) ?? t("params.actionTags.CLIENT_MESSAGE"), channels: p.channels.map((c) => t(`params.channelLabels.${c}`)).join(", ") })
          : null,
        p.invoiceTo?.length ? t("checked.invoices", { to: p.invoiceTo.join(", ") }) : null,
      ].filter(Boolean);
      return parts.length ? withEntity(parts.join(". ")) : null;
    }
    case "SEPARATION":
      return t("checked.separation", { entities: (p.entityIds ?? []).map(entityName).join(t("checked.separationJoin")) });
    default:
      return null;
  }
}

/// Spec 3.11: when the rule starts and when it is reviewed, in a line.
function datesLine(t: PoliciesT, format: Formatter, p: PanelPolicy): string | null {
  const parts: string[] = [];
  if (p.effectiveFrom) {
    const from = new Date(`${p.effectiveFrom}T00:00:00Z`);
    const date = format.dateTime(from, { ...NUMERIC_DAY, timeZone: "UTC" });
    parts.push(from.getTime() > Date.now() ? t("dates.startsOn", { date }) : t("dates.inForceFrom", { date }));
  }
  if (p.reviewBy) {
    const date = format.dateTime(new Date(`${p.reviewBy}T00:00:00Z`), { ...NUMERIC_DAY, timeZone: "UTC" });
    parts.push(p.reviewDue ? t("dates.reviewOverdue", { date }) : t("dates.reviewBy", { date }));
  }
  return parts.length ? parts.join(" · ") : null;
}

function ExceptionForm({ clientId, policy, maxDays }: { clientId: string; policy: PanelPolicy; maxDays: number }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(requestExceptionAction, close);
  const t = useTranslations("clients.policies");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="policyId" value={policy.id} />
      <p className="text-xs text-app-text-secondary">
        {t("exception.rule")} <span dir="auto">{policy.statement}</span>
      </p>
      <Field label={t("exception.what")}>
        <textarea name="what" required rows={2} placeholder={t("exception.whatPlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("exception.reason")}>
        <input name="reason" required placeholder={t("exception.reasonPlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("exception.until")}>
        <input name="validUntil" type="date" required className={INPUT} />
      </Field>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("exception.maxDays", { max: maxDays })}</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("sending") : t("exception.submit")}
      </button>
    </form>
  );
}

function RejectExceptionForm({ clientId, exception }: { clientId: string; exception: PanelException }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectExceptionAction, close);
  const t = useTranslations("clients.policies");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={exception.id} />
      <p className="text-sm text-app-text-primary" dir="auto">{exception.what}</p>
      <Field label={t("exception.rejectReason")}>
        <input name="note" required className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("exception.rejectSubmit")}
      </button>
    </form>
  );
}

function ApproversForm({ clientId, staff, selected }: { clientId: string; staff: { id: string; name: string }[]; selected: string[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setRuleApproversAction, close);
  const t = useTranslations("clients.policies");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <p className="text-xs text-app-text-secondary">
        {t("approvers.hint")}
      </p>
      <fieldset className="flex flex-col gap-1.5">
        {staff.map((u) => (
          <label key={u.id} className="flex items-center gap-1.5 text-sm text-app-text-primary">
            <input type="checkbox" name="approver" value={u.id} defaultChecked={selected.includes(u.id)} className="h-4 w-4 accent-gold" />
            {u.name}
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("save")}
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
  const t = useTranslations("clients.policies");
  const tk = useTranslations("clients.knowledge");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {existing?.status === "ACTIVE" && (
        <p className="rounded-lg bg-app-warning-soft px-3 py-2 text-xs text-app-warning">
          {t("form.activeWarning")}
        </p>
      )}
      <Field label={t("form.kind")}>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PolicyKindLike)} className={INPUT}>
          {POLICY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
      </Field>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t(`kindHints.${kind}`)}</p>
      <Field label={t("form.title")}>
        <input name="title" required defaultValue={existing?.title ?? ""} placeholder={t("form.titlePlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("form.statement")}>
        <textarea name="statement" required rows={3} defaultValue={existing?.statement ?? ""} placeholder={t("form.statementPlaceholder")} className={INPUT} />
      </Field>
      <Field label={NEEDS_INTERIM.includes(kind) ? t("form.interimRequired") : t("form.interim")}>
        <textarea
          name="interimStatement"
          rows={2}
          required={NEEDS_INTERIM.includes(kind)}
          defaultValue={existing?.interimStatement ?? ""}
          placeholder={t("form.interimPlaceholder")}
          className={INPUT}
        />
      </Field>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("form.interimHint")}</p>
      <PolicyParamsFields
        key={kind}
        kind={kind}
        initial={existing?.kind === kind ? existing.params : undefined}
        initialInterim={existing?.kind === kind ? existing.interimParams : undefined}
        entities={entities}
      />
      <Field label={t("form.rationale")}>
        <input name="rationale" defaultValue={existing?.rationale ?? ""} className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.effectiveFrom")}>
          <input type="date" name="effectiveFrom" defaultValue={existing?.effectiveFrom ?? ""} className={INPUT} />
        </Field>
        <Field label={t("form.reviewBy")}>
          <input type="date" name="reviewBy" defaultValue={existing?.reviewBy ?? ""} className={INPUT} />
        </Field>
      </div>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("form.datesHint")}</p>
      <Field label={t("form.knowledgeStatus")}>
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{tk("status.CONFIRMED")}</option>
          <option value="UNCERTAIN">{tk("status.UNCERTAIN")}</option>
          <option value="MISSING">{tk("status.MISSING")}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.knowledgeStatus === "CONFIRMED"} />
      <ItemExtras existing={existing} disclose audience />
      {status !== "CONFIRMED" && (
        <Field label={tk("toResolve")}>
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : existing ? t("save") : t("addToFile")}
      </button>
    </form>
  );
}

function RetireForm({ clientId, policy }: { clientId: string; policy: PanelPolicy }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(retirePolicyAction, close);
  const t = useTranslations("clients.policies");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={policy.id} />
      <p className="text-sm text-app-text-primary" dir="auto">{policy.title}</p>
      <Field label={t("retire.reason")}>
        <input name="reason" required placeholder={t("retire.reasonPlaceholder")} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("retire.submit")}
      </button>
    </form>
  );
}


/// Spec 3.11: the rule's earlier versions, folded, so what was agreed
/// before can be read without the audit log.
function PolicyHistory({ history }: { history: NonNullable<PanelPolicy["history"]> }) {
  const t = useTranslations("clients.policies");
  const format = useFormatter();
  const shortDay = (iso: string) => format.dateTime(new Date(iso), NUMERIC_DAY);
  return (
    <details className="mt-1.5" data-testid="policy-history">
      <summary className="cursor-pointer text-[11px] text-app-text-secondary">{t("history.summary", { count: history.length })}</summary>
      <ul className="mt-1 space-y-1.5 border-s border-app-border ps-3">
        {history.map((h) => (
          <li key={h.version} className="text-xs text-app-text-secondary">
            <p className="font-medium" dir="auto">
              {h.title ? t("history.versionTitled", { version: h.version, title: h.title }) : t("history.version", { version: h.version })}
            </p>
            <p dir="auto">{h.statement}</p>
            {h.interimStatement && <p className="text-app-text-secondary">{t("history.interim")} <span dir="auto">{h.interimStatement}</span></p>}
            {h.checked && <p className="text-app-text-secondary">{t("history.checked")} {h.checked}</p>}
            <p className="text-[11px] text-app-text-tertiary">
              {[
                h.approvedByName
                  ? h.approvedAt
                    ? t("history.approvedByOn", { name: h.approvedByName, date: shortDay(h.approvedAt) })
                    : t("history.approvedBy", { name: h.approvedByName })
                  : t("history.notApproved"),
                h.until ? t("history.replacedOn", { date: shortDay(h.until) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PoliciesPanel({
  clientId,
  policies,
  sourceOptions,
  canApprove,
  canApproveRules,
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
  /// 31.10.2026: approves a proposed rule: a manager, or the client's
  /// account manager. Defaults to `canApprove`.
  canApproveRules?: boolean;
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
  const t = useTranslations("clients.policies");
  const tk = useTranslations("clients.knowledge");
  const format = useFormatter();
  const entityNames = new Map(entities.map((e) => [e.id, e.name]));
  const entityName = (id: string) => entityNames.get(id) ?? t("checked.removedEntity");
  const live = policies.filter((p) => p.status !== "RETIRED");
  const retired = policies.filter((p) => p.status === "RETIRED");

  async function approve(p: PanelPolicy) {
    const r = await approvePolicyAction(p.id, clientId);
    if (r.error) showToast({ tone: "error", title: t("toast.approveFailed"), description: r.error });
    else showToast({ tone: "success", title: t("toast.ruleActive"), description: p.title });
  }
  async function decide(e: PanelException) {
    const r = await approveExceptionAction(e.id, clientId);
    if (r.error) showToast({ tone: "error", title: t("toast.approveFailed"), description: r.error });
    else showToast({ tone: "success", title: t("toast.exceptionApproved"), description: e.what.slice(0, 80) });
  }
  async function withdraw(e: PanelException) {
    const r = await withdrawExceptionAction(e.id, clientId);
    if (r.error) showToast({ tone: "error", title: t("toast.withdrawFailed"), description: r.error });
    else showToast({ tone: "info", title: t("toast.withdrawn"), description: e.what.slice(0, 80) });
  }
  async function remove(p: PanelPolicy) {
    const r = await removePolicyAction(p.id, clientId);
    if (r.error) showToast({ tone: "error", title: t("toast.removeFailed"), description: r.error });
    else showToast({ tone: "info", title: t("toast.removed"), description: p.title });
  }

  return (
    <div id="rules" className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">{t("heading", { count: live.length })}</h2>
        <Drawer triggerLabel={t("add")} title={t("addTitle")} variant="link">
          <PolicyForm clientId={clientId} sourceOptions={sourceOptions} entities={entities} />
        </Drawer>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-app-text-tertiary">
        <span>
          {approvers.length ? t("approvers.line", { names: approvers.map((a) => a.name).join(", ") }) : t("approvers.none")}
          {clientApproverIds.length > 0 && ` ${t("approvers.setByClient")}`}
        </span>
        {canApprove && (
          <Drawer triggerLabel={t("approvers.change")} title={t("approvers.title")} variant="link">
            <ApproversForm clientId={clientId} staff={staff} selected={clientApproverIds} />
          </Drawer>
        )}
      </p>
      {live.length === 0 ? (
        <p className="mt-2 text-sm text-app-text-tertiary">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {live.map((p) => {
            const checked = checkedLine(t, p.kind, paramsInForce({ ...p, effectiveFrom: p.effectiveFrom ? new Date(`${p.effectiveFrom}T00:00:00Z`) : null }), entityName);
            const dates = datesLine(t, format, p);
            return (
            <li key={p.id} id={`item-${p.id}`} className="flex flex-wrap items-start justify-between gap-3 py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
              <div className="min-w-0 flex-[1_1_18rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-app-text-primary" dir="auto">{p.title}</p>
                  <StatusBadge label={t(`statuses.${p.status}`)} tone={STATUS_TONE[p.status]} />
                  <span className="text-[11px] text-app-text-tertiary">
                    {t(`kinds.${p.kind}`)}
                    {p.version > 1 && ` · ${t("history.version", { version: p.version })}`}
                  </span>
                </div>
                {p.status === "PROPOSED" && p.interimStatement ? (
                  <>
                    <p className="mt-1 text-xs text-app-text-primary">
                      <span className="font-medium">{t("row.interim")} </span>
                      <span dir="auto">{p.interimStatement}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-app-text-secondary">
                      {t("row.proposed")} <span dir="auto">{p.statement}</span>
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-app-text-primary" dir="auto">{p.statement}</p>
                )}
                {p.rationale && (
                  <p className="mt-0.5 text-xs text-app-text-secondary">
                    {t("row.why")} <span dir="auto">{p.rationale}</span>
                  </p>
                )}
                {checked ? (
                  <p className="mt-0.5 text-xs text-app-text-secondary">
                    <span className="font-medium">{t("row.checked")} </span>
                    {checked}
                  </p>
                ) : (
                  kindTakesParams(p.kind) && <p className="mt-0.5 text-[11px] text-app-text-tertiary">{t("row.textOnly")}</p>
                )}
                {dates && (
                  <p className={`mt-0.5 text-[11px] ${p.reviewDue ? "text-app-warning" : "text-app-text-secondary"}`} data-testid="policy-dates">
                    {dates}
                  </p>
                )}
                {p.status === "ACTIVE" && p.approvedByName && (
                  <p className="mt-0.5 text-[11px] text-app-text-tertiary">
                    {p.approvedAt
                      ? t("history.approvedByOn", { name: p.approvedByName, date: format.dateTime(new Date(p.approvedAt), NUMERIC_DAY) })
                      : t("history.approvedBy", { name: p.approvedByName })}
                  </p>
                )}
                <StatusLine status={p.knowledgeStatus} toResolve={p.toResolve} />
                {/* A rule we are not sure the client said cannot become binding
                    (approveClientPolicy). Say how to get there, instead of
                    offering an approval the server refuses (20.10.2026). */}
                {(canApproveRules ?? canApprove) && p.status === "PROPOSED" && p.knowledgeStatus !== "CONFIRMED" && (
                  <p className="mt-1 text-[11px] text-app-text-secondary" data-testid="policy-approve-blocked">
                    {t("row.approveBlocked", { status: tk("status.CONFIRMED") })}
                  </p>
                )}
                <ItemTags item={p} disclose />
                {p.history && p.history.length > 0 && <PolicyHistory history={p.history} />}
                <SourceCodes sources={p.sources} options={sourceOptions} />
                {exceptions
                  .filter((e) => e.policyId === p.id)
                  .map((e) => (
                    <div key={e.id} className="mt-2 rounded-lg border border-app-border bg-app-surface-sunken px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge label={e.status === "APPROVED" ? t("exception.badgeUntil", { date: dayLabel(format, e.validUntil) }) : t("exception.badgeRequest")} tone={e.status === "APPROVED" ? "gray" : "amber"} />
                        <span className="text-app-text-primary" dir="auto">{e.what}</span>
                      </div>
                      <p className="mt-1 text-app-text-secondary">
                        {t("row.why")} <span dir="auto">{e.reason}</span>
                        {e.status === "REQUESTED" && ` · ${t("exception.until2", { date: dayLabel(format, e.validUntil) })}`}
                        {e.requestedByName && ` · ${t("exception.requestedBy", { name: e.requestedByName })}`}
                        {e.decidedByName && ` · ${t("exception.decidedBy", { name: e.decidedByName })}`}
                        {e.decisionNote && ` · ${e.decisionNote}`}
                      </p>
                      {e.status === "REQUESTED" && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-3">
                          {canDecideExceptions && (
                            <>
                              <button type="button" onClick={() => decide(e)} className="font-medium text-app-text-accent hover:underline">
                                {t("exception.approve")}
                              </button>
                              <Drawer triggerLabel={t("exception.reject")} title={t("exception.rejectTitle")} variant="link">
                                <RejectExceptionForm clientId={clientId} exception={e} />
                              </Drawer>
                            </>
                          )}
                          {e.requestedById === viewerId && (
                            <button type="button" onClick={() => withdraw(e)} className="text-app-text-tertiary hover:text-app-text-primary">
                              {t("exception.withdraw")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {(canApproveRules ?? canApprove) && p.status === "PROPOSED" && p.knowledgeStatus === "CONFIRMED" && (
                  <button type="button" onClick={() => approve(p)} className="font-medium text-app-text-accent hover:underline">
                    {t("row.approve")}
                  </button>
                )}
                <Drawer triggerLabel={t("row.edit")} title={t("row.editTitle", { title: p.title })} variant="link">
                  <PolicyForm clientId={clientId} sourceOptions={sourceOptions} entities={entities} existing={p} />
                </Drawer>
                <Drawer triggerLabel={t("row.requestException")} title={t("row.requestExceptionTitle", { title: p.title })} variant="link">
                  <ExceptionForm clientId={clientId} policy={p} maxDays={maxExceptionDays} />
                </Drawer>
                {canApprove && (
                  <Drawer triggerLabel={t("row.retire")} title={t("row.retireTitle", { title: p.title })} variant="link">
                    <RetireForm clientId={clientId} policy={p} />
                  </Drawer>
                )}
                {p.status === "PROPOSED" && (
                  <button type="button" onClick={() => remove(p)} className="text-app-text-tertiary hover:text-app-error">
                    {t("row.remove")}
                  </button>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      {retired.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-app-text-tertiary">{t("retired", { count: retired.length })}</summary>
          <ul className="mt-2 space-y-1.5">
            {retired.map((p) => (
              <li key={p.id} className="text-xs text-app-text-tertiary" dir="auto">
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
  const t = useTranslations("clients.policies.disclosure");
  if (rules.length === 0) return null;
  return (
    // 31.10.2026: one line, so the file's index stays near the top. The first
    // rule is always in full; the others open under "עוד".
    <div role="note" className="rounded-xl border border-app-warning/30 bg-app-warning-soft px-4 py-2 text-xs text-app-warning" data-testid="disclosure-banner">
      <p>
        <span className="font-medium">{t("lead")} </span>
        <span className="font-medium" dir="auto">{rules[0].title}: </span>
        <span dir="auto">{rules[0].text}</span>
        {rules[0].proposed && ` ${t("proposed")}`}
      </p>
      {rules.length > 1 && (
        <details className="mt-1">
          <summary className="cursor-pointer font-medium">{t("more", { count: rules.length - 1 })}</summary>
          <ul className="mt-1 space-y-1">
            {rules.slice(1).map((r) => (
              <li key={r.id}>
                <span className="font-medium" dir="auto">{r.title}: </span>
                <span dir="auto">{r.text}</span>
                {r.proposed && ` ${t("proposed")}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
