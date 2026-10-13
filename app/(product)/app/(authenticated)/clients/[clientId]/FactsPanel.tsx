"use client";
import { useState } from "react";
import Link from "next/link";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_AUDIENCE_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  FACT_KIND_LABELS,
  FACT_SECTIONS,
  FACT_TOPIC_LABELS,
  isPastValidity,
  type FactKindLike,
  type FactTopicLike,
} from "@/lib/client-facts";
import {
  addClientFactAction,
  supersedeClientFactAction,
  confirmClientFactAction,
  answerClientQuestionAction,
  questionToTaskAction,
  closeTemporaryFactAction,
  removeClientFactAction,
} from "../fact-actions";
import { Field, INPUT, SourceCodes, SourcesField, StatusLine, type SourceOption } from "./knowledge-ui";

// Org brain, phase 2: the facts of the client file, sections 2, 4, 5, 7.3,
// 8, 11, 12 and 13 of Hadas's file (claude/org-brain-spec-2026-10-12.md,
// 3.4).
//
// Only sections with something in them are shown: an empty heading is
// one more thing to read that says nothing. A fact's words are never
// edited; "החלפה" writes the new version and keeps the old one under
// "היסטוריה", so the file can always say what we thought before.

export type PanelFact = {
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
  doNotDisclose: string | null;
  sources: string[];
  supersededAt: string | null;
  /// Other versions somebody said, each with its sources (spec 5.2).
  alternatives: { value: string; sources: string[] }[];
};

type Option = { value: string; label: string };

function dateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
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

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {existing ? (
        <>
          <input type="hidden" name="kind" value={kind} />
          <p className="text-xs text-appNavy/60">
            הגרסה הנוכחית תישמר בהיסטוריה, מסומנת &quot;הוחלף&quot;, והחדשה תופיע במקומה.
          </p>
        </>
      ) : (
        <Field label="סוג">
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as FactKindLike)} className={INPUT}>
            {FACT_SECTIONS.map((s) => (
              <option key={s.kind} value={s.kind}>
                {FACT_KIND_LABELS[s.kind]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={question ? "השאלה *" : "מה *"}>
        <textarea name="body" required rows={3} defaultValue={existing?.body ?? ""} className={INPUT} />
      </Field>

      {(kind === "PREFERENCE" || kind === "REQUIREMENT") && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="נושא">
            <select name="topic" defaultValue={existing?.topic ?? "COMMUNICATION"} className={INPUT}>
              {(Object.keys(FACT_TOPIC_LABELS) as FactTopicLike[]).map((t) => (
                <option key={t} value={t}>
                  {FACT_TOPIC_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="של מי">
            <select name="subject" defaultValue={existing?.subjectKey ?? ""} className={INPUT}>
              <option value="">הלקוח</option>
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
        <Field label="למי מפנים">
          <input name="referTo" defaultValue={existing?.referTo ?? ""} placeholder="Nextage" className={INPUT} />
        </Field>
      )}
      {kind === "TEMPORARY" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="בתוקף עד">
            <input name="validUntil" type="date" dir="ltr" defaultValue={existing?.validUntil?.slice(0, 10) ?? ""} className={INPUT} />
          </Field>
          <Field label="או עד אירוע">
            <input name="validUntilEvent" defaultValue={existing?.validUntilEvent ?? ""} placeholder="עד הצירוף לארגון" className={INPUT} />
          </Field>
        </div>
      )}
      {kind === "ONE_OFF_DECISION" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="תאריך ההחלטה *">
            <input name="decidedAt" type="date" dir="ltr" required defaultValue={existing?.decidedAt?.slice(0, 10) ?? ""} className={INPUT} />
          </Field>
          <Field label="מי החליט">
            <input name="decidedBy" defaultValue={existing?.decidedBy ?? ""} className={INPUT} />
          </Field>
        </div>
      )}
      {question && (
        <Field label="מי אחראי לברר">
          <select name="assigneeId" defaultValue={existing?.assigneeId ?? ""} className={INPUT}>
            <option value="">לא נקבע</option>
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
      )}
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={question ? "MISSING" : status} />
      {(question || status !== "CONFIRMED") && (
        <Field label={question ? "מה יסגור אותה" : "מה יסגור את זה *"}>
          <input name="toResolve" required={!question} defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {(question || status !== "CONFIRMED") && (
        <label className="flex items-center gap-2 text-sm text-appNavy">
          <input type="checkbox" name="lowImportance" defaultChecked={existing?.lowImportance} className="h-4 w-4 accent-gold" />
          לא קריטי
        </label>
      )}
      <Field label="למי אסור לספר">
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירת הגרסה החדשה" : "הוספה לתיק"}
      </button>
    </form>
  );
}

function ConfirmForm({ clientId, fact, sourceOptions }: { clientId: string; fact: PanelFact; sourceOptions: SourceOption[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(confirmClientFactAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={fact.id} />
      <p className="text-sm text-appNavy">{fact.body}</p>
      <SourcesField options={sourceOptions} defaultValue={fact.sources.join(", ")} status="CONFIRMED" />
      <p className="-mt-2 text-[11px] text-appNavy/40">צריך מקור מהלקוח או מספק שלו. מסמך של אנקורה לבד לא מאשר.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "אישור"}
      </button>
    </form>
  );
}

function AnswerForm({ clientId, fact, sourceOptions }: { clientId: string; fact: PanelFact; sourceOptions: SourceOption[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(answerClientQuestionAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={fact.id} />
      <p className="text-sm text-appNavy">{fact.body}</p>
      <Field label="התשובה *">
        <textarea name="answer" required rows={3} className={INPUT} />
      </Field>
      <SourcesField options={sourceOptions} status="CONFIRMED" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "שמירת התשובה"}
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
  const closed = !!fact.closedAt;
  const answered = !!fact.answeredAt;
  const pastValidity = isPastValidity(
    { kind: fact.kind, validUntil: fact.validUntil ? new Date(fact.validUntil) : null, closedAt: fact.closedAt ? new Date(fact.closedAt) : null },
    new Date(now)
  );

  async function act(fn: () => Promise<{ error?: string }>, done: string) {
    const r = await fn();
    if (r.error) showToast({ tone: "error", title: "הפעולה נכשלה", description: r.error });
    else showToast({ tone: "info", title: done, description: fact.body.slice(0, 80) });
  }

  const meta = [
    fact.topic ? FACT_TOPIC_LABELS[fact.topic] : null,
    fact.subject,
    fact.referTo ? `מפנים ל: ${fact.referTo}` : null,
    fact.kind === "TEMPORARY" ? `בתוקף עד ${dateLabel(fact.validUntil) ?? fact.validUntilEvent}` : null,
    fact.kind === "ONE_OFF_DECISION" ? [dateLabel(fact.decidedAt), fact.decidedBy].filter(Boolean).join(", ") : null,
    fact.kind === "QUESTION" && fact.assigneeName ? `אחראי: ${fact.assigneeName}` : null,
    fact.lowImportance ? "לא קריטי" : null,
  ].filter(Boolean);

  return (
    <li className={`py-3 ${closed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-appNavy">{fact.body}</p>
          {meta.length > 0 && <p className="mt-0.5 text-xs text-appNavy/60">{meta.join(" · ")}</p>}
          {answered && (
            <p className="mt-1 text-xs text-appNavy/80">
              תשובה ({dateLabel(fact.answeredAt)}): {fact.answer}
            </p>
          )}
          {closed && <p className="mt-1 text-xs text-appNavy/50">נסגר ב-{dateLabel(fact.closedAt)}</p>}
          {fact.alternatives.map((a, i) => (
            <p key={i} className="mt-1 text-xs text-warning">
              גרסה אחרת: {a.value}
              {a.sources.length > 0 && <span dir="ltr"> [{a.sources.join(", ")}]</span>}
            </p>
          ))}
          {pastValidity && (
            <div className="mt-1.5">
              <StatusBadge label="עבר התוקף. עדיין נכון?" tone="amber" />
            </div>
          )}
          {fact.taskId && (
            <p className="mt-1 text-xs">
              <Link href={`/app/tasks/${fact.taskId}`} className="text-gold-dim hover:underline">
                למשימה
              </Link>
            </p>
          )}
          {fact.doNotDisclose && <p className="mt-1 text-xs text-red-700">לא לספר: {fact.doNotDisclose}</p>}
          {fact.kind !== "QUESTION" && <StatusLine status={fact.status} toResolve={fact.toResolve} />}
          {fact.kind === "QUESTION" && !answered && fact.toResolve && fact.toResolve !== "תשובה לשאלה." && (
            <p className="mt-1 text-xs text-appNavy/60">{fact.toResolve}</p>
          )}
          <SourceCodes sources={fact.sources} options={sourceOptions} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
          {fact.kind === "QUESTION" && !answered && (
            <Drawer triggerLabel="תשובה" title="תשובה לשאלה" variant="link">
              <AnswerForm clientId={clientId} fact={fact} sourceOptions={sourceOptions} />
            </Drawer>
          )}
          {fact.kind === "QUESTION" && !answered && !fact.taskId && (
            <button type="button" onClick={() => act(() => questionToTaskAction(fact.id, clientId), "נפתחה משימה")} className="text-gold-dim hover:underline">
              למשימה
            </button>
          )}
          {fact.kind !== "QUESTION" && (fact.status === "UNCERTAIN" || fact.status === "MISSING") && (
            <Drawer triggerLabel="אישור" title="אישור פריט" variant="link">
              <ConfirmForm clientId={clientId} fact={fact} sourceOptions={sourceOptions} />
            </Drawer>
          )}
          {fact.kind === "TEMPORARY" && !closed && (
            <button type="button" onClick={() => act(() => closeTemporaryFactAction(fact.id, clientId), "נסגר")} className="text-appNavy/60 hover:text-appNavy">
              כבר לא נכון
            </button>
          )}
          {!answered && !closed && (
            <Drawer triggerLabel="החלפה" title={`גרסה חדשה: ${FACT_KIND_LABELS[fact.kind]}`} variant="link">
              <FactForm clientId={clientId} sourceOptions={sourceOptions} subjects={subjects} staff={staff} existing={fact} />
            </Drawer>
          )}
          <button type="button" onClick={() => act(() => removeClientFactAction(fact.id, clientId), "הוסר מהתיק")} className="text-appNavy/50 hover:text-red-600">
            הסרה
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

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-appNavy">
          תיק הלקוח: עובדות ({facts.length})
          {openQuestions > 0 && <span className="ms-2 text-xs font-normal text-warning">{openQuestions} שאלות פתוחות</span>}
        </h2>
        <Drawer triggerLabel="+ פריט" title="פריט חדש בתיק" variant="link">
          <FactForm clientId={clientId} sourceOptions={sourceOptions} subjects={subjects} staff={staff} />
        </Drawer>
      </div>
      {sections.length === 0 ? (
        <p className="mt-2 text-sm text-appNavy/50">
          אין עדיין עובדות בתיק: תחומי אחריות, העדפות, דרישות, מידע זמני, החלטות ושאלות פתוחות נכנסים לכאן.
        </p>
      ) : (
        sections.map((s) => (
          <section key={s.kind} className="mt-5">
            <h3 className="text-xs font-medium text-appNavy/60">
              {s.section && <span className="me-1.5 font-mono text-gold-dim">{s.section}</span>}
              {s.title} ({s.items.length})
            </h3>
            <ul className="mt-1 divide-y divide-lineDark">
              {s.items.map((f) => (
                <FactRow key={f.id} fact={f} clientId={clientId} sourceOptions={sourceOptions} subjects={subjects} staff={staff} now={now} />
              ))}
            </ul>
          </section>
        ))
      )}
      {history.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-appNavy/50">היסטוריה: גרסאות שהוחלפו ({history.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((f) => (
              <li key={f.id} className="text-xs text-appNavy/50">
                <span className="me-1.5">{FACT_KIND_LABELS[f.kind]}:</span>
                <span className="line-through">{f.body}</span>
                {f.supersededAt && <span className="ms-1.5">(הוחלף ב-{dateLabel(f.supersededAt)})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
