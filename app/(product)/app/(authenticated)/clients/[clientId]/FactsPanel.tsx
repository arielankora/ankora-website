"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { KnowledgeStatusLike } from "@/lib/knowledge";
import { FACT_SECTIONS, FACT_TOPIC_LABELS, isPastValidity, QUESTION_DEFAULT_TO_RESOLVE, type FactKindLike, type FactTopicLike } from "@/lib/client-facts";
import {
  addClientFactAction,
  supersedeClientFactAction,
  confirmClientFactAction,
  answerClientQuestionAction,
  questionToTaskAction,
  closeTemporaryFactAction,
  removeClientFactAction,
} from "../fact-actions";
import { Field, INPUT, SourceCodes, SourcesField, StatusLine, type SourceOption, ItemExtras, ItemTags, AudienceField } from "./knowledge-ui";

// Org brain, phase 2: the facts of the client file, sections 2, 4, 5, 7.3,
// 8, 11, 12 and 13 of Hadas's file (claude/org-brain-spec-2026-10-12.md,
// 3.4).
//
// Only sections with something in them are shown: an empty heading is
// one more thing to read that says nothing. A fact's words are never
// edited; "החלפה" writes the new version and keeps the old one under
// "היסטוריה", so the file can always say what we thought before.

export type PanelFact = {
  /// When a person last confirmed it, as ISO.
  verifiedAt?: string | null;
  /// Spec 3.1: the team's refs, as form text and as labels.
  externalRefs?: string;
  refs?: string[];
  clientVisible?: boolean;
  ownerId?: string | null;
  id: string;
  kind: FactKindLike;
  topic: FactTopicLike | null;
  body: string;
  subject: string | null;
  subjectKey: string;
  referTo: string | null;
  validUntil: string | null;
  validUntilEvent: string | null;
  closedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  answer: string | null;
  answeredAt: string | null;
  taskId: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  lowImportance: boolean;
  audience: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  audienceUserIds?: string[];
  doNotDisclose: string | null;
  sources: string[];
  supersededAt: string | null;
  /// Other versions somebody said, each with its sources (spec 5.2).
  alternatives: { value: string; sources: string[] }[];
};

type Option = { value: string; label: string };

/// A date-only value (its day in UTC), as the reader writes dates.
function useDateLabel() {
  const format = useFormatter();
  return (iso: string | null): string | null =>
    iso ? format.dateTime(new Date(`${iso.slice(0, 10)}T00:00:00Z`), { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }) : null;
}

function FactForm({
  clientId,
  sourceOptions,
  subjects,
  staff,
  existing,
  initialKind,
}: {
  clientId: string;
  sourceOptions: SourceOption[];
  subjects: Option[];
  staff: Option[];
  existing?: PanelFact;
  initialKind?: FactKindLike;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? supersedeClientFactAction : addClientFactAction, close);
  const [kind, setKind] = useState<FactKindLike>(existing?.kind ?? initialKind ?? "PREFERENCE");
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing && existing.status !== "SUPERSEDED" ? existing.status : "CONFIRMED");
  const question = kind === "QUESTION";
  const t = useTranslations("clients.facts");
  const tk = useTranslations("clients.knowledge");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {existing ? (
        <>
          <input type="hidden" name="kind" value={kind} />
          <p className="text-xs text-app-text-secondary">
            {t("form.supersedeHint", { status: tk("status.SUPERSEDED") })}
          </p>
        </>
      ) : (
        <Field label={t("form.kind")}>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as FactKindLike)} className={INPUT}>
            {FACT_SECTIONS.map((s) => (
              <option key={s.kind} value={s.kind}>
                {t(`kinds.${s.kind}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={question ? t("form.question") : t("form.body")}>
        <textarea name="body" required rows={3} defaultValue={existing?.body ?? ""} className={INPUT} />
      </Field>

      {(kind === "PREFERENCE" || kind === "REQUIREMENT") && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.topic")}>
            <select name="topic" defaultValue={existing?.topic ?? "COMMUNICATION"} className={INPUT}>
              {(Object.keys(FACT_TOPIC_LABELS) as FactTopicLike[]).map((topic) => (
                <option key={topic} value={topic}>
                  {t(`topics.${topic}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.subject")}>
            <select name="subject" defaultValue={existing?.subjectKey ?? ""} className={INPUT}>
              <option value="">{t("form.subjectClient")}</option>
              {subjects.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {kind === "SCOPE_OUT" && (
        <Field label={t("form.referTo")}>
          <input name="referTo" defaultValue={existing?.referTo ?? ""} placeholder="Nextage" className={INPUT} />
        </Field>
      )}
      {kind === "TEMPORARY" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.validUntil")}>
            <input name="validUntil" type="date" dir="ltr" defaultValue={existing?.validUntil?.slice(0, 10) ?? ""} className={INPUT} />
          </Field>
          <Field label={t("form.validUntilEvent")}>
            <input name="validUntilEvent" defaultValue={existing?.validUntilEvent ?? ""} placeholder={t("form.validUntilEventPlaceholder")} className={INPUT} />
          </Field>
        </div>
      )}
      {kind === "ONE_OFF_DECISION" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.decidedAt")}>
            <input name="decidedAt" type="date" dir="ltr" required defaultValue={existing?.decidedAt?.slice(0, 10) ?? ""} className={INPUT} />
          </Field>
          <Field label={t("form.decidedBy")}>
            <input name="decidedBy" defaultValue={existing?.decidedBy ?? ""} className={INPUT} />
          </Field>
        </div>
      )}
      {(question || kind === "TEMPORARY") && (
        <Field label={question ? t("form.assigneeQuestion") : t("form.assigneeTemporary")}>
          <select name="assigneeId" defaultValue={existing?.assigneeId ?? ""} className={INPUT}>
            <option value="">{t("form.noAssignee")}</option>
            {staff.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!question && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={tk("statusLabel")}>
            <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
              <option value="CONFIRMED">{tk("status.CONFIRMED")}</option>
              <option value="UNCERTAIN">{tk("status.UNCERTAIN")}</option>
              <option value="MISSING">{tk("status.MISSING")}</option>
            </select>
          </Field>
          <AudienceField existing={existing} />
        </div>
      )}
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={question ? "MISSING" : status} />
      <ItemExtras existing={existing} />
      {(question || status !== "CONFIRMED") && (
        <Field label={question ? t("form.toResolveQuestion") : tk("toResolve")}>
          <input name="toResolve" required={!question} defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {(question || status !== "CONFIRMED") && (
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          <input type="checkbox" name="lowImportance" defaultChecked={existing?.lowImportance} className="h-4 w-4 accent-gold" />
          {t("lowImportance")}
        </label>
      )}
      <Field label={tk("doNotDisclose")}>
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : existing ? t("form.saveVersion") : t("addToFile")}
      </button>
    </form>
  );
}

function ConfirmForm({ clientId, fact, sourceOptions }: { clientId: string; fact: PanelFact; sourceOptions: SourceOption[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(confirmClientFactAction, close);
  const t = useTranslations("clients.facts");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={fact.id} />
      <p className="text-sm text-app-text-primary" dir="auto">{fact.body}</p>
      <SourcesField options={sourceOptions} defaultValue={fact.sources.join(", ")} status="CONFIRMED" />
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("confirm.hint")}</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("confirm.submit")}
      </button>
    </form>
  );
}

function AnswerForm({ clientId, fact, sourceOptions }: { clientId: string; fact: PanelFact; sourceOptions: SourceOption[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(answerClientQuestionAction, close);
  const t = useTranslations("clients.facts");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={fact.id} />
      <p className="text-sm text-app-text-primary" dir="auto">{fact.body}</p>
      <Field label={t("answer.label")}>
        <textarea name="answer" required rows={3} className={INPUT} />
      </Field>
      <SourcesField options={sourceOptions} status="CONFIRMED" />
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("answer.submit")}
      </button>
    </form>
  );
}

function FactRow({
  fact,
  clientId,
  sourceOptions,
  subjects,
  staff,
  now,
}: {
  fact: PanelFact;
  clientId: string;
  sourceOptions: SourceOption[];
  subjects: Option[];
  staff: Option[];
  now: number;
}) {
  const { showToast } = useToast();
  const t = useTranslations("clients.facts");
  const dateLabel = useDateLabel();
  const closed = !!fact.closedAt;
  const answered = !!fact.answeredAt;
  const pastValidity = isPastValidity(
    { kind: fact.kind, validUntil: fact.validUntil ? new Date(fact.validUntil) : null, closedAt: fact.closedAt ? new Date(fact.closedAt) : null },
    new Date(now)
  );

  async function act(fn: () => Promise<{ error?: string }>, done: string) {
    const r = await fn();
    if (r.error) showToast({ tone: "error", title: t("toast.failed"), description: r.error });
    else showToast({ tone: "info", title: done, description: fact.body.slice(0, 80) });
  }

  const meta = [
    fact.topic ? t(`topics.${fact.topic}`) : null,
    fact.subject,
    fact.referTo ? t("row.referTo", { name: fact.referTo }) : null,
    fact.kind === "TEMPORARY" ? t("row.validUntil", { until: dateLabel(fact.validUntil) ?? fact.validUntilEvent ?? "" }) : null,
    fact.kind === "ONE_OFF_DECISION" ? [dateLabel(fact.decidedAt), fact.decidedBy].filter(Boolean).join(", ") : null,
    (fact.kind === "QUESTION" || fact.kind === "TEMPORARY") && fact.assigneeName ? t("row.assignee", { name: fact.assigneeName }) : null,
    fact.lowImportance ? t("lowImportance") : null,
  ].filter(Boolean);

  return (
    <li id={`item-${fact.id}`} className={`py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft ${closed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_18rem]">
          <p className="text-sm text-app-text-primary" dir="auto">{fact.body}</p>
          {meta.length > 0 && <p className="mt-0.5 text-xs text-app-text-secondary">{meta.join(" · ")}</p>}
          {answered && (
            <p className="mt-1 text-xs text-app-text-primary">
              {t("row.answer", { date: dateLabel(fact.answeredAt) ?? "" })} <span dir="auto">{fact.answer}</span>
            </p>
          )}
          {closed && <p className="mt-1 text-xs text-app-text-tertiary">{t("row.closedOn", { date: dateLabel(fact.closedAt) ?? "" })}</p>}
          {fact.alternatives.map((a, i) => (
            <p key={i} className="mt-1 text-xs text-app-warning">
              {t("row.alternative")} <span dir="auto">{a.value}</span>
              {a.sources.length > 0 && <span dir="ltr"> [{a.sources.join(", ")}]</span>}
            </p>
          ))}
          {pastValidity && (
            <div className="mt-1.5">
              <StatusBadge label={t("row.pastValidity")} tone="amber" />
            </div>
          )}
          {fact.taskId && (
            <p className="mt-1 text-xs">
              <Link href={`/app/tasks/${fact.taskId}`} className="text-app-text-accent hover:underline">
                {t("row.toTask")}
              </Link>
            </p>
          )}
          {fact.doNotDisclose && <p className="mt-1 text-xs text-app-error">{t("row.doNotTell", { text: fact.doNotDisclose })}</p>}
          {fact.kind !== "QUESTION" && <StatusLine status={fact.status} toResolve={fact.toResolve} />}
          <ItemTags item={fact} />
          {fact.kind === "QUESTION" && !answered && fact.toResolve && fact.toResolve !== QUESTION_DEFAULT_TO_RESOLVE && (
            <p className="mt-1 text-xs text-app-text-secondary" dir="auto">{fact.toResolve}</p>
          )}
          <SourceCodes sources={fact.sources} options={sourceOptions} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
          {fact.kind === "QUESTION" && !answered && (
            <Drawer triggerLabel={t("row.answerAction")} title={t("answer.title")} variant="link">
              <AnswerForm clientId={clientId} fact={fact} sourceOptions={sourceOptions} />
            </Drawer>
          )}
          {fact.kind === "QUESTION" && !answered && !fact.taskId && (
            <button type="button" onClick={() => act(() => questionToTaskAction(fact.id, clientId), t("toast.taskOpened"))} className="text-app-text-accent hover:underline">
              {t("row.toTask")}
            </button>
          )}
          {fact.kind !== "QUESTION" && (fact.status === "UNCERTAIN" || fact.status === "MISSING") && (
            <Drawer triggerLabel={t("confirm.submit")} title={t("confirm.title")} variant="link">
              <ConfirmForm clientId={clientId} fact={fact} sourceOptions={sourceOptions} />
            </Drawer>
          )}
          {fact.kind === "TEMPORARY" && !closed && !fact.taskId && (
            <button type="button" onClick={() => act(() => questionToTaskAction(fact.id, clientId), t("toast.taskOpened"))} className="text-app-text-accent hover:underline">
              {t("row.toTask")}
            </button>
          )}
          {fact.kind === "TEMPORARY" && !closed && (
            <button type="button" onClick={() => act(() => closeTemporaryFactAction(fact.id, clientId), t("toast.closed"))} className="text-app-text-secondary hover:text-app-text-primary">
              {t("row.noLongerTrue")}
            </button>
          )}
          {!answered && !closed && (
            <Drawer triggerLabel={t("row.supersede")} title={t("row.supersedeTitle", { kind: t(`kinds.${fact.kind}`) })} variant="link">
              <FactForm clientId={clientId} sourceOptions={sourceOptions} subjects={subjects} staff={staff} existing={fact} />
            </Drawer>
          )}
          <button type="button" onClick={() => act(() => removeClientFactAction(fact.id, clientId), t("toast.removed"))} className="text-app-text-tertiary hover:text-app-error">
            {t("row.remove")}
          </button>
        </div>
      </div>
    </li>
  );
}

export function FactsPanel({
  clientId,
  facts,
  history,
  sourceOptions,
  subjects,
  staff,
  now,
}: {
  clientId: string;
  facts: PanelFact[];
  history: PanelFact[];
  sourceOptions: SourceOption[];
  subjects: Option[];
  staff: Option[];
  /// The server's clock, so the page and its first paint agree on what
  /// has expired.
  now: number;
}) {
  const sections = FACT_SECTIONS.map((s) => ({ ...s, items: facts.filter((f) => f.kind === s.kind) })).filter((s) => s.items.length > 0);
  const openQuestions = facts.filter((f) => f.kind === "QUESTION" && !f.answeredAt).length;
  const t = useTranslations("clients.facts");
  const dateLabel = useDateLabel();

  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">
          {t("heading", { count: facts.length })}
          {openQuestions > 0 && <span className="ms-2 text-xs font-normal text-app-warning">{t("openQuestions", { count: openQuestions })}</span>}
        </h2>
        <Drawer triggerLabel={t("add")} title={t("addTitle")} variant="link">
          <FactForm clientId={clientId} sourceOptions={sourceOptions} subjects={subjects} staff={staff} />
        </Drawer>
      </div>
      {sections.length === 0 ? (
        <p className="mt-2 text-sm text-app-text-tertiary">
          {t("empty")}
        </p>
      ) : (
        sections.map((s) => (
          <section key={s.kind} className="mt-5">
            <h3 className="text-xs font-medium text-app-text-secondary">
              {s.section && <span className="me-1.5 font-mono text-app-text-accent">{s.section}</span>}
              {t(`sections.${s.kind}`)} ({s.items.length})
            </h3>
            <ul className="mt-1 divide-y divide-app-border">
              {s.items.map((f) => (
                <FactRow key={f.id} fact={f} clientId={clientId} sourceOptions={sourceOptions} subjects={subjects} staff={staff} now={now} />
              ))}
            </ul>
          </section>
        ))
      )}
      {history.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-app-text-tertiary">{t("history", { count: history.length })}</summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((f) => (
              <li key={f.id} className="text-xs text-app-text-tertiary">
                <span className="me-1.5">{t(`kinds.${f.kind}`)}:</span>
                <span className="line-through" dir="auto">{f.body}</span>
                {f.supersededAt && <span className="ms-1.5">{t("supersededOn", { date: dateLabel(f.supersededAt) ?? "" })}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
