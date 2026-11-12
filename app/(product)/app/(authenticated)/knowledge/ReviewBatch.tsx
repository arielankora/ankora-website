"use client";
import { batchAnchor, proposalAnchor } from "@/lib/approval-links";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { KnowledgeStatusLike } from "@/lib/knowledge";
import {
  MAX_BULK,
  reviewSummaryCounts,
  suggestedFix,
  type ConfidenceLike,
  type ConfidenceReasonCode,
  type DetailPart,
  type ProposalFlag,
  type ProposalActionLike,
  type ProposalTargetLike,
  type TierReasonCode,
} from "@/lib/knowledge-proposals";
import type { ProcedureAlongside } from "@/lib/app-domain/processes";
import { detailLine, sourceKindLabel, targetLabel as kindLabelOf, type KnowledgeT } from "./labels";
import { approveProposalAction, approveEditedProposalAction, approveWithSuggestionAction, approveProposalsAction, attachProposalAction, mergeProposalAction, proposalToTaskAction, rejectProposalAction, rejectProposalsAction, revertProposalAction } from "./actions";

// One batch: one meeting or one document, and what Claude proposed from
// it (spec 5.2). Each proposal shows what it would write, how sure it is
// and why, the moment in the recording, and the rule flags. Three
// actions: approve, edit and approve, reject with a line.

export type ReviewProposal = {
  id: string;
  target: ProposalTargetLike;
  action: ProposalActionLike;
  state: "PENDING" | "APPROVED" | "REJECTED" | "TASK";
  headline: string;
  payload: Record<string, unknown>;
  sources: string[];
  reason: string | null;
  quote: string | null;
  flags: ProposalFlag[];
  link: string | null;
  existing: { body: string } | null;
  /// A new item that is already in the file, as it stands now: what is
  /// there, and whether "כבר בתיק" adds this proposal's sources to it.
  alreadyIn: { body: string; addsSources: boolean } | null;
  /// Closed by "כבר בתיק": nothing was created.
  attached: boolean;
  /// Approved, and its item taken out of the file again ("ביטול").
  reverted: boolean;
  /// Approved by the server on arrival (the AUTO tier), not by a person.
  autoApplied?: boolean;
  /// Approved, and its item may still be taken out again (revertBlocker).
  revertible: boolean;
  rejectReason: string | null;
  /// Sensitive and this person is not an approver (R6): who decides it.
  hiddenFor: string | null;
  /// Spec 5.2: how sure, with why it is lower, and its place on the card.
  /// `reasons` is `why` as codes (ADR 0006), which the card words.
  confidence: { level: ConfidenceLike; why: string[]; reasons: ConfidenceReasonCode[] };
  rank: number;
  /// Why it is approved on its own, not with others (bulkApproveBlockerCode).
  aloneBecause: TierReasonCode | null;
  /// What a reviewer needs beyond the headline (proposalDetailParts).
  details: DetailPart[];
  /// The approvers of a sensitive item hidden from this person, by name.
  hiddenApprovers: string[];
  /// Something to do, not to know: the task it would open, why it cannot
  /// (taskBlocker), and the task it opened once it did.
  /// `needsTitle`: it was something to know, so the person writes what to
  /// do; `said` is what was said; `due` the date already filled in.
  task: { title: string; description: string; needsTitle?: boolean; said?: string; due?: string };
  taskBlocked: string | null;
  taskId: string | null;
  /// A process proposal whose approval also approves its procedure, when
  /// it passes the checks (3.11.2026): the button says so.
  combinedProcedure?: boolean;
};

export type ReviewStaff = { id: string; name: string }[];

/// The line under a card's source (ADR 0006: parts, worded here).
export type SourceDetails = { kind: string | null; occurredAt: Date | null; participants: string[]; topicsOnly: boolean; sentBy: string | null };

/// "הקלטה · 12.11.2026 · נושאים בלבד · נשלח על ידי ...". Also the
/// awaiting-assignment card's line.
export function useSourceDetailsLine(d: SourceDetails): string {
  const t = useTranslations("knowledge");
  const format = useFormatter();
  return [
    d.kind ? sourceKindLabel(t, d.kind) : null,
    // A date of the source, kept at midnight UTC.
    d.occurredAt ? format.dateTime(d.occurredAt, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }) : null,
    d.participants.join(", ") || null,
    d.topicsOnly ? t("source.topicsOnly") : null,
    d.sentBy ? t("source.sentBy", { name: d.sentBy }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

/// The fields a reviewer may change, per kind of item, with the key of
/// each label under knowledge.edit.fields.
type FieldLabel =
  | "body"
  | "validUntilEvent"
  | "decidedBy"
  | "decidedAt"
  | "name"
  | "role"
  | "context"
  | "orgRole"
  | "notes"
  | "requestTitle"
  | "handling"
  | "policyTitle"
  | "statement"
  | "interimStatement"
  | "systemName"
  | "systemPurpose"
  | "blocker"
  | "legalName"
  | "registrationNumber"
  | "narrativeBody"
  | "processTitle"
  | "processPurpose"
  | "triggerText"
  | "domain"
  | "taskTitle"
  | "description"
  | "assigneeName"
  | "dueDate"
  | "dateTitle"
  | "date"
  | "responsibleName";

const EDIT_FIELDS: Record<ProposalTargetLike, { key: string; label: FieldLabel; long?: boolean }[]> = {
  FACT: [
    { key: "body", label: "body", long: true },
    { key: "validUntilEvent", label: "validUntilEvent" },
    { key: "decidedBy", label: "decidedBy" },
    { key: "decidedAt", label: "decidedAt" },
  ],
  CONTACT: [
    { key: "name", label: "name" },
    { key: "role", label: "role" },
    { key: "context", label: "context", long: true },
  ],
  ORGANIZATION: [
    { key: "name", label: "name" },
    { key: "role", label: "orgRole" },
    { key: "notes", label: "notes", long: true },
  ],
  REQUEST_TYPE: [
    { key: "title", label: "requestTitle" },
    { key: "handling", label: "handling", long: true },
  ],
  POLICY: [
    { key: "title", label: "policyTitle" },
    { key: "statement", label: "statement", long: true },
    { key: "interimStatement", label: "interimStatement", long: true },
  ],
  SYSTEM: [
    { key: "systemName", label: "systemName" },
    { key: "purpose", label: "systemPurpose" },
    { key: "blocker", label: "blocker" },
    { key: "notes", label: "notes", long: true },
  ],
  ENTITY: [
    { key: "name", label: "name" },
    { key: "legalName", label: "legalName" },
    { key: "registrationNumber", label: "registrationNumber" },
  ],
  NARRATIVE: [{ key: "body", label: "narrativeBody", long: true }],
  PROCESS: [
    { key: "title", label: "processTitle" },
    { key: "purpose", label: "processPurpose" },
    { key: "triggerText", label: "triggerText" },
  ],
  DOMAIN: [{ key: "domain", label: "domain" }],
  TASK: [
    { key: "title", label: "taskTitle" },
    { key: "description", label: "description", long: true },
    { key: "assigneeName", label: "assigneeName" },
    { key: "dueDate", label: "dueDate" },
  ],
  DATE: [
    { key: "title", label: "dateTitle" },
    { key: "date", label: "date" },
    { key: "responsibleName", label: "responsibleName" },
    { key: "notes", label: "notes", long: true },
  ],
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/// 3.11.2026: what approving a process proposal did to its procedure, as
/// the toast says it. Null when it did nothing to it (as before).
function procedureToast(t: KnowledgeT, procedure: ProcedureAlongside | null | undefined, headline: string) {
  if (!procedure) return null;
  return procedure.approved
    ? { tone: "info" as const, title: t("toasts.processAndProcedureApproved"), description: headline.slice(0, 80) }
    : { tone: "info" as const, title: t("toasts.processDraftProcedureWaits"), description: procedure.reason };
}

function EditForm({ p }: { p: ReviewProposal }) {
  const t = useTranslations("knowledge");
  const close = useDrawerClose();
  const { showToast } = useToast();
  const { onSubmit, pending, error } = useActionForm(approveEditedProposalAction, (r) => {
    const toast = procedureToast(t, r.procedure, p.headline);
    if (toast) showToast(toast);
    close();
  });
  const status = (str(p.payload.knowledgeStatus) || "CONFIRMED") as KnowledgeStatusLike;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={p.id} />
      {EDIT_FIELDS[p.target]
        .filter((f) => f.key !== "validUntilEvent" || p.payload.kind === "TEMPORARY")
        .filter((f) => (f.key !== "decidedBy" && f.key !== "decidedAt") || p.payload.kind === "ONE_OFF_DECISION")
        .map((f) => (
          <label key={f.key} className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t(`edit.fields.${f.label}`)}</span>
            {f.long ? (
              <textarea name={f.key} rows={3} defaultValue={str(p.payload[f.key])} className={INPUT} />
            ) : (
              <input name={f.key} defaultValue={str(p.payload[f.key])} className={INPUT} />
            )}
          </label>
        ))}
      {p.target !== "TASK" && p.target !== "DATE" && (p.target !== "FACT" || p.payload.kind !== "QUESTION") ? (
        <>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("edit.status")}</span>
            <select name="knowledgeStatus" defaultValue={status} className={INPUT}>
              <option value="CONFIRMED">{t("statuses.CONFIRMED")}</option>
              <option value="UNCERTAIN">{t("statuses.UNCERTAIN")}</option>
              <option value="MISSING">{t("statuses.MISSING")}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("edit.toResolveIfNotConfirmed")}</span>
            <input name="toResolve" defaultValue={str(p.payload.toResolve)} className={INPUT} />
          </label>
        </>
      ) : p.target === "FACT" && p.payload.kind === "QUESTION" ? (
        // A question has no status, but what closes it may still be said.
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">{t("edit.whatClosesQuestion")}</span>
          <input name="toResolve" defaultValue={str(p.payload.toResolve)} className={INPUT} />
        </label>
      ) : null}
      {p.target !== "NARRATIVE" && p.target !== "DOMAIN" && p.target !== "TASK" && p.target !== "DATE" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("edit.ownerName")}</span>
            <input name="ownerName" defaultValue={str(p.payload.ownerName)} className={INPUT} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("edit.clientVisible")}</span>
            <select name="clientVisible" defaultValue={p.payload.clientVisible === true ? "yes" : "no"} className={INPUT}>
              <option value="no">{t("edit.no")}</option>
              <option value="yes">{t("edit.yes")}</option>
            </select>
          </label>
        </div>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : p.target === "TASK" ? t("edit.openTask") : p.combinedProcedure ? t("edit.approveCombinedWithChanges") : t("edit.approveWithChanges")}
      </button>
    </form>
  );
}

function RejectForm({ p }: { p: ReviewProposal }) {
  const t = useTranslations("knowledge");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectProposalAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={p.id} />
      <p className="text-sm text-app-text-primary" dir="auto">
        {p.headline}
      </p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("reject.whyLabel")}</span>
        <input name="reason" required placeholder={t("reject.placeholder")} className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("reject.submit")}
      </button>
    </form>
  );
}

function TaskForm({ p, staff, meId }: { p: ReviewProposal; staff: ReviewStaff; meId: string }) {
  const t = useTranslations("knowledge");
  const close = useDrawerClose();
  const { showToast } = useToast();
  const { onSubmit, pending, error } = useActionForm(proposalToTaskAction, () => {
    showToast({ tone: "info", title: t("toasts.taskOpened"), description: p.task.title.slice(0, 80) });
    close();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" data-testid="proposal-task-form">
      <input type="hidden" name="id" value={p.id} />
      <p className="text-xs text-app-text-secondary">{t("task.intro")}</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("task.titleLabel")}</span>
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={p.task.title}
          placeholder={p.task.needsTitle ? t("task.titlePlaceholder") : undefined}
          className={INPUT}
          data-testid="proposal-task-title"
        />
      </label>
      {p.task.needsTitle && p.task.said && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">
          {t("task.said", { said: p.task.said })}
        </p>
      )}
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("task.description")}</span>
        <textarea name="description" rows={6} defaultValue={p.task.description} className={INPUT} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">{t("task.assignee")}</span>
          <select name="assignedToId" defaultValue={meId} className={INPUT}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">{t("task.dueDate")}</span>
          <input type="date" name="dueDate" defaultValue={p.task.due} className={INPUT} />
        </label>
      </div>
      <p className="-mt-1.5 text-[11px] text-app-text-tertiary">{t("task.categoryHint")}</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("task.priority")}</span>
        <select name="priority" defaultValue="NORMAL" className={INPUT}>
          <option value="LOW">{t("priority.LOW")}</option>
          <option value="NORMAL">{t("priority.NORMAL")}</option>
          <option value="HIGH">{t("priority.HIGH")}</option>
          <option value="URGENT">{t("priority.URGENT")}</option>
        </select>
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("task.opening") : t("task.submit")}
      </button>
    </form>
  );
}

function RejectManyForm({ ids }: { ids: string[] }) {
  const t = useTranslations("knowledge");
  // The selection is not cleared here. Clearing it empties `chosen`,
  // which unmounts this drawer in the same commit, and the drawer is the
  // one that refreshes the screen after a write (see Drawer). Rejected
  // proposals leave `decidable` on that refresh, so they leave `chosen`
  // with it; any that failed stay selected for another try.
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectProposalsAction, () => close());
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      {ids.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <p className="text-sm text-app-text-primary">{t("rejectMany.intro", { count: ids.length })}</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("reject.whyLabel")}</span>
        <input name="reason" required placeholder={t("rejectMany.placeholder")} className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("reject.submit")}
      </button>
    </form>
  );
}

/// "ביטול" on an approved new item (3.11.2026): the item is taken out of
/// the file again, and the proposal stays approved, marked reverted. Two
/// steps on the row, not the browser's confirm() (see SetupForms.tsx).
function RevertButton({ p }: { p: ReviewProposal }) {
  const t = useTranslations("knowledge");
  const { showToast } = useToast();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="ms-1.5 text-app-text-accent hover:underline" data-testid="proposal-revert">
        {t("revert.button")}
      </button>
    );
  }
  async function revert() {
    setPending(true);
    const r = await revertProposalAction(p.id);
    setPending(false);
    setAsking(false);
    if (r.error) showToast({ tone: "error", title: t("revert.failed"), description: r.error });
    else showToast({ tone: "info", title: t("revert.done"), description: p.headline.slice(0, 80) });
  }
  return (
    <span className="ms-1.5 inline-flex flex-wrap items-center gap-2">
      <span className="text-app-text-secondary">{t("revert.confirm")}</span>
      <button type="button" disabled={pending} onClick={revert} className="font-medium text-app-error disabled:opacity-50" data-testid="proposal-revert-confirm">
        {pending ? t("revert.removing") : t("revert.remove")}
      </button>
      <button type="button" disabled={pending} onClick={() => setAsking(false)} className="text-app-text-secondary">
        {t("revert.keep")}
      </button>
    </span>
  );
}

function ProposalRow({ p, selected, onSelect, staff, meId }: { p: ReviewProposal; selected: boolean; onSelect: (on: boolean) => void; staff: ReviewStaff; meId: string }) {
  const t = useTranslations("knowledge");
  const format = useFormatter();
  const { showToast } = useToast();
  const status = (str(p.payload.knowledgeStatus) || (p.payload.kind === "QUESTION" ? "MISSING" : "CONFIRMED")) as KnowledgeStatusLike;
  const kindLabel = kindLabelOf(t, p);

  async function approve() {
    const r = await approveProposalAction(p.id);
    if (r.error) showToast({ tone: "error", title: t("toasts.approveFailed"), description: r.error });
    else showToast(procedureToast(t, r.procedure, p.headline) ?? { tone: "info", title: p.target === "TASK" ? t("toasts.taskOpened") : t("toasts.enteredFile"), description: p.headline.slice(0, 80) });
  }

  async function approveSuggested() {
    const r = await approveWithSuggestionAction(p.id);
    if (r.error) showToast({ tone: "error", title: t("toasts.approveFailed"), description: r.error });
    else showToast(procedureToast(t, r.procedure, p.headline) ?? { tone: "info", title: t("toasts.completedAndEntered"), description: p.headline.slice(0, 80) });
  }

  async function attach() {
    const r = await attachProposalAction(p.id);
    if (r.error) showToast({ tone: "error", title: t("toasts.notClosed"), description: r.error });
    else showToast({ tone: "info", title: p.alreadyIn?.addsSources ? t("toasts.sourceAdded") : t("toasts.closedAlreadyIn"), description: p.alreadyIn?.body.slice(0, 80) });
  }

  async function merge(m: { id: string; name: string }) {
    const r = await mergeProposalAction(p.id, m.id);
    if (r.error) showToast({ tone: "error", title: t("toasts.mergeFailed"), description: r.error });
    else showToast({ tone: "info", title: t("toasts.merged", { name: m.name }), description: p.headline.slice(0, 80) });
  }

  if (p.state !== "PENDING") {
    return (
      <li id={proposalAnchor(p.id)} className="py-2.5 text-xs text-app-text-tertiary scroll-mt-24 rounded-lg target:bg-app-accent-soft">
        {p.state === "APPROVED"
          ? p.reverted
            ? t("decided.reverted")
            : p.autoApplied
              ? t("decided.autoApplied")
              : p.attached
                ? t("decided.alreadyIn")
                : p.target === "TASK"
                  ? t("decided.taskOpened")
                  : t("decided.approved")
          : p.state === "TASK"
            ? t("decided.becameTask")
            : t("decided.rejected")}{" "}
        <bdi>{p.headline}</bdi>
        {p.rejectReason && (
          <>
            {" ("}
            <bdi>{p.rejectReason}</bdi>
            {")"}
          </>
        )}
        {p.taskId && (
          <a href={`/app/tasks/${p.taskId}`} className="ms-1.5 text-app-text-accent hover:underline">
            {t("decided.toTask")}
          </a>
        )}
        {p.revertible && <RevertButton p={p} />}
      </li>
    );
  }

  if (p.hiddenFor) {
    return (
      <li id={proposalAnchor(p.id)} className="py-3.5 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
        <p className="text-xs text-app-text-tertiary">{kindLabel}</p>
        <p className="mt-0.5 text-sm text-app-text-secondary">
          {t("sensitiveHidden", { who: p.hiddenApprovers.length ? p.hiddenApprovers.join(` ${t("or")} `) : t("sensitiveApprovers") })}
        </p>
      </li>
    );
  }

  const doubtful = p.flags.some((f) => f.code === "DUPLICATE" || f.code === "SIMILAR");
  const blocked = p.flags.some((f) => f.block);
  // Every problem has a ready wording: one press completes and approves.
  const suggested = !p.alreadyIn && suggestedFix(p.flags) !== null;
  const alone = p.aloneBecause;
  return (
    <li id={proposalAnchor(p.id)} className={`py-3.5 scroll-mt-24 rounded-lg target:bg-app-accent-soft ${selected ? "bg-gold/[0.04]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={t("proposal.select", { headline: p.headline.slice(0, 60) })}
          title={alone ? t("proposal.aloneHint", { reason: t(`tierReasons.${alone}`) }) : undefined}
          className="mt-1 h-4 w-4 shrink-0 accent-gold"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-app-text-tertiary">
            {kindLabel}
            {p.action !== "CREATE" && <span className="ms-1.5 text-app-warning">· {t(`actions.${p.action}`)}</span>}
          </p>
          <p className="mt-0.5 text-sm text-app-text-primary" dir="auto">
            {p.headline}
          </p>
          {p.details.map((part, i) => (
            <p key={i} className="mt-0.5 whitespace-pre-line text-xs text-app-text-secondary" dir="auto">
              {detailLine(t, part, (n) => format.number(n))}
            </p>
          ))}
          {p.alreadyIn && (
            <p className="mt-1 text-xs text-app-warning" data-testid="proposal-already-in">
              {t("proposal.alreadyIn")}{" "}
              <bdi className="text-app-text-secondary">{p.alreadyIn.body}</bdi>
            </p>
          )}
          {p.existing && (
            <p className="mt-1 text-xs text-app-text-secondary">
              {t("proposal.inFileToday")}{" "}
              <bdi className={p.action === "SUPERSEDE" ? "line-through" : ""}>{p.existing.body}</bdi>
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-app-text-secondary">
            {status !== "CONFIRMED" && (status === "UNCERTAIN" || status === "MISSING" || status === "SUPERSEDED") && (
              <StatusBadge label={t(`statuses.${status}`)} tone={status === "MISSING" ? "red" : "amber"} />
            )}
            {str(p.payload.toResolve) && <span dir="auto">{str(p.payload.toResolve)}</span>}
            {p.state === "PENDING" && (
              <span title={p.confidence.reasons.map((r) => t(`confidenceReasons.${r}`)).join(" · ") || undefined} data-testid="proposal-confidence">
                <StatusBadge label={t(`confidence.${p.confidence.level}`)} tone={p.confidence.level === "HIGH" ? "green" : p.confidence.level === "LOW" ? "red" : "gray"} />
              </span>
            )}
            {p.state === "PENDING" && p.confidence.reasons.length > 0 && p.confidence.level !== "HIGH" && <span>{p.confidence.reasons.map((r) => t(`confidenceReasons.${r}`)).join(", ")}</span>}
            {p.sources.length > 0 && <span dir="ltr">[{p.sources.join(", ")}]</span>}
            {p.link && (
              <a href={p.link} target="_blank" rel="noreferrer" className="text-app-text-accent hover:underline">
                {t("proposal.momentInCall")}
              </a>
            )}
          </div>
          {p.reason && (
            <p className="mt-1 text-xs text-app-text-secondary">
              {t("proposal.why")} <bdi>{p.reason}</bdi>
            </p>
          )}
          {p.quote && (
            <p className="mt-1 border-s-2 border-app-border ps-2 text-xs italic text-app-text-secondary" dir="auto">
              {p.quote}
            </p>
          )}
          {/* "Already in the file" is said once, above, with what is there. */}
          {p.flags.filter((f) => !(p.alreadyIn && f.code === "DUPLICATE")).map((f, i) => (
            // The flag's sentences are written by the domain in Hebrew and
            // stored with the proposal (ADR 0006: not yet coded), so they
            // read in their own direction.
            <p key={i} className={`mt-1 text-xs ${f.block ? "font-medium text-app-error" : "text-app-warning"}`} data-testid="proposal-flag">
              <bdi>{f.message}</bdi>
              {f.why && (
                <span className="block font-normal text-app-text-secondary">
                  {t("proposal.why")} <bdi>{f.why}</bdi>
                </span>
              )}
              {f.fix && (
                <span className="block font-normal text-app-text-secondary" data-testid="proposal-suggested">
                  {t("proposal.suggested")} <bdi className="text-app-text-primary">{f.fix.label}</bdi>
                </span>
              )}
              {/* The same item under another spelling: added to it, not a second one. */}
              {/* A date is not merged: the existing one is opened and completed. */}
              {f.match && p.target === "DATE" && (
                <a href={`/app/important-dates/${f.match.id}`} className="ms-2 font-medium text-app-text-accent hover:underline" data-testid="proposal-date-match">
                  {t("proposal.openDate", { name: f.match.name })}
                </a>
              )}
              {f.match && !blocked && p.target !== "DATE" && (
                <button type="button" onClick={() => merge(f.match!)} className="ms-2 font-medium text-app-text-accent hover:underline" data-testid="proposal-merge">
                  {t("proposal.addTo", { name: f.match.name })}
                </button>
              )}
            </p>
          ))}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-3 text-xs">
          {/* A problem that blocks approval (spec 5.2) is fixed in the edit,
              where the server checks the approved text again. */}
          {/* Already in the file: approving would make a second copy, or
              be refused. The primary action closes it onto the item there. */}
          {p.alreadyIn ? (
            <button type="button" onClick={attach} className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary">
              {p.alreadyIn.addsSources ? t("proposal.alreadyInAddSource") : t("proposal.alreadyInClose")}
            </button>
          ) : (
            <>
              {suggested && (
                <button type="button" onClick={approveSuggested} className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary" data-testid="proposal-approve-suggested">
                  {p.combinedProcedure ? t("proposal.approveSuggestedCombined") : t("proposal.approveSuggested")}
                </button>
              )}
              {/* A process that only lacks a check enters as a draft: it may
                  also be approved as it is. */}
              {!blocked && (
                <button
                  type="button"
                  onClick={approve}
                  className={`rounded-full px-3.5 py-1.5 font-medium ${doubtful || suggested ? "border border-app-border text-app-text-secondary" : "bg-app-accent text-app-text-primary"}`}
                >
                  {p.combinedProcedure ? t("proposal.approveCombined") : t("proposal.approve")}
                </button>
              )}
            </>
          )}
          <Drawer triggerLabel={t("proposal.editAndApprove")} title={t("proposal.editTitle")} variant="link">
            <EditForm p={p} />
          </Drawer>
          {/* Not knowledge but something to do: a task, not a rejection
              and not an item forced into the file. */}
          {!p.taskBlocked ? (
            <Drawer triggerLabel={t("proposal.toTask")} title={t("proposal.toTaskTitle")} variant="link">
              <TaskForm p={p} staff={staff} meId={meId} />
            </Drawer>
          ) : null}
          <Drawer triggerLabel={t("reject.submit")} title={t("reject.title")} variant="link">
            <RejectForm p={p} />
          </Drawer>
        </div>
      </div>
    </li>
  );
}

export function ReviewBatch({
  batchId,
  clientId,
  clientName,
  sourceLabel,
  sourceDetails,
  note,
  droppedCount,
  proposals,
  filtered = false,
  staff,
  meId,
}: {
  /// The batch, for the link that opens it (lib/approval-links.ts).
  batchId?: string;
  clientId: string;
  clientName: string;
  /// The source's code and title (content), or null: no source.
  sourceLabel: string | null;
  sourceDetails: SourceDetails;
  note: string | null;
  droppedCount: number;
  proposals: ReviewProposal[];
  /// The screen is filtered, and `proposals` is only what matches. Said
  /// on the select-all, so "all" never reads as the whole batch.
  filtered?: boolean;
  /// Who a task opened from a proposal may go to, and who it goes to by default.
  staff: ReviewStaff;
  meId: string;
}) {
  const t = useTranslations("knowledge");
  const details = useSourceDetailsLine(sourceDetails);
  const { showToast } = useToast();
  const pending = proposals.filter((p) => p.state === "PENDING");
  // What this person may decide here: not a sensitive item hidden from them.
  const decidable = pending.filter((p) => !p.hiddenFor);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = decidable.filter((p) => selected.has(p.id));
  const approvable = chosen.filter((p) => !p.aloneBecause);
  const allTogether = decidable.filter((p) => !p.aloneBecause);
  const select = (id: string, on: boolean) =>
    setSelected((all) => {
      const next = new Set(all);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const [busy, setBusy] = useState(false);

  async function approveChosen() {
    setBusy(true);
    const r = await approveProposalsAction(approvable.slice(0, MAX_BULK).map((p) => p.id));
    setBusy(false);
    if (r.error) {
      showToast({ tone: "error", title: t("toasts.approveFailed"), description: r.error });
      return;
    }
    setSelected(new Set((r.failed ?? []).map((f) => f.id)));
    if (r.failed?.length) showToast({ tone: "error", title: t("toasts.someEntered", { done: r.done ?? 0, failed: r.failed.length }), description: r.failed[0].error });
    else showToast({ tone: "info", title: t("toasts.entered", { count: r.done ?? 0 }) });
  }
  const counts = Object.entries(
    pending.reduce<Record<string, number>>((acc, p) => {
      const k = kindLabelOf(t, p);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  );
  return (
    <section id={batchId ? batchAnchor(batchId) : undefined} className="scroll-mt-24 rounded-2xl border border-app-border bg-white p-6 target:border-app-accent target:ring-2 target:ring-app-accent">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-app-text-tertiary">
            <a href={`/app/clients/${clientId}/client-file`} className="hover:text-app-text-accent" dir="auto">
              {clientName}
            </a>
          </p>
          <h2 className="text-sm font-medium text-app-text-primary" dir="auto">
            {sourceLabel ?? t("source.none")}
          </h2>
          {details && <p className="text-xs text-app-text-secondary">{details}</p>}
        </div>
        <p className="text-xs text-app-text-secondary">{counts.map(([k, n]) => t("batch.kindCount", { count: n, kind: k })).join(" · ")}</p>
      </div>
      {/* Spec 5.2: how much of the card goes together, before reading it. */}
      {(() => {
        const c = reviewSummaryCounts(decidable.map((p) => p.rank));
        if (!c) return null;
        const line =
          c.alone === 0
            ? t("summary.allTogether", { count: c.together })
            : c.together === 0
              ? t("summary.allAlone", { count: c.alone })
              : t("summary.mixed", { alone: t("summary.mixedAlone", { count: c.alone }), together: t("summary.mixedTogether", { count: c.together }) });
        return (
          <p className="mt-2 text-xs font-medium text-app-text-secondary" data-testid="review-summary">
            {line}
          </p>
        );
      })()}
      {note && (
        <p className="mt-2 text-xs text-app-text-secondary" dir="auto">
          {note}
        </p>
      )}
      {droppedCount > 0 && <p className="mt-2 text-xs text-app-warning">{t("batch.dropped", { count: droppedCount })}</p>}
      {decidable.length > 1 && (
        // No backdrop-blur here. A backdrop filter makes this bar the
        // containing block of every fixed descendant, so the reject
        // drawer below opened inside the bar's 40px instead of the
        // viewport: clipped, with its reason field and button cut off
        // (20.10.2026). Opaque enough without it.
        <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-app-border bg-white px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5 text-app-text-primary">
            <input
              type="checkbox"
              checked={chosen.length > 0 && chosen.length === decidable.length}
              onChange={(e) => setSelected(new Set(e.target.checked ? decidable.map((p) => p.id) : []))}
              className="h-4 w-4 accent-gold"
            />
            {filtered ? t("batch.selectAllFiltered", { count: decidable.length }) : t("batch.selectAll", { count: decidable.length })}
          </label>
          {allTogether.length > 0 && allTogether.length < decidable.length && (
            <button type="button" onClick={() => setSelected(new Set(allTogether.map((p) => p.id)))} className="text-app-text-accent hover:underline">
              {t("batch.selectTogether", { count: allTogether.length })}
            </button>
          )}
          {chosen.length > 0 && (
            <>
              <span className="text-app-text-tertiary">{t("batch.chosen", { count: chosen.length })}</span>
              <button
                type="button"
                onClick={approveChosen}
                disabled={busy || approvable.length === 0}
                className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary disabled:opacity-40"
              >
                {busy ? t("batch.approving") : t("batch.approveCount", { count: approvable.length })}
              </button>
              <Drawer triggerLabel={t("batch.rejectCount", { count: chosen.length })} title={t("rejectMany.title")} variant="link">
                <RejectManyForm ids={chosen.map((p) => p.id)} />
              </Drawer>
              {approvable.length < chosen.length && <span className="text-app-text-tertiary">{t("batch.someAlone", { count: chosen.length - approvable.length })}</span>}
            </>
          )}
        </div>
      )}
      <ul className="mt-3 divide-y divide-app-border">
        {proposals.map((p) => (
          <ProposalRow key={p.id} p={p} selected={selected.has(p.id)} onSelect={(on) => select(p.id, on)} staff={staff} meId={meId} />
        ))}
      </ul>
    </section>
  );
}
