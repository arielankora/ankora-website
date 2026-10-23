"use client";
import { useEffect, useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  ACTION_TAGS,
  ACTION_TAG_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  MAX_PROCESS_STEPS,
  MONEY_TAGS,
  STEP_MODE_LABELS,
  TRANSITION_LABELS,
  TRIGGER_LABELS,
  type ActionTag,
  type Channel,
  type ProcessStep,
  type StepModeLike,
  type TransitionLike,
  type TriggerLike,
} from "@/lib/process-rules";
import {
  addProcessAction,
  linkProcessDatesAction,
  removeProcessAction,
  resolveLessonAction,
  runProcessStepAction,
  saveProcessVersionAction,
  setProcessStatusAction,
  startProcessRunAction,
  updateProcessAction,
} from "../process-actions";
import Link from "next/link";
import { formatAmount } from "@/lib/policy-params";
import { REVIEW_REASON_LABELS, type ReviewReason } from "@/lib/process-review";
import { nextSteps, type DateCandidate, type NextStep, type ProcessFacts } from "@/lib/next-steps";
import { CHECK_STATE_LABELS, type CheckState } from "@/lib/process-checks";
import { ProcessCheckForm } from "./ProcessCheckForm";
import { LESSON_STATUS_LABELS, type LessonStatusLike } from "@/lib/process-lessons";
import { EntitySelect, Field, INPUT, LABEL, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption, ItemExtras, ItemTags } from "./knowledge-ui";
import { BUSINESS_CALENDARS, BUSINESS_CALENDAR_LABELS } from "@/lib/business-calendar";

// Org brain, phase 1: processes and their procedures, section 7.4 of the
// client file (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9).
//
// A card per process: what triggers it, who owns it, where it stands in
// the handover, how complete it is (Oren's nine fields) and what is
// missing, and the procedure in force. A new procedure is a draft until a
// manager approves it, and the checks that would block it show on the
// draft before anyone presses the button.

type Option = { id: string; name: string };

export type PanelProcess = {
  /// 21.10.2026: open tasks of the client this approved process covers.
  covered?: { taskId: string; title: string; assignee: string | null }[];
  /// 22.10.2026: what "הצעד הבא" reads. The fields still missing (their
  /// labels), the systems without access, and the date recommended.
  missing?: string[];
  noAccess?: { id: string; name: string }[];
  dateCandidate?: DateCandidate | null;
  /// When a person last confirmed it, as ISO.
  verifiedAt?: string | null;
  /// When a run was last closed, as ISO.
  lastRunAt?: string | null;
  /// Spec 3.1: the team's refs, as form text and as labels.
  externalRefs?: string;
  refs?: string[];
  audience?: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  audienceUserIds?: string[];
  clientVisible?: boolean;
  doNotDisclose?: string | null;
  id: string;
  code: string;
  title: string;
  purpose: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "RETIRED";
  triggerKinds: TriggerLike[];
  triggerText: string | null;
  ownerId: string | null;
  backupOwnerId: string | null;
  slaText: string | null;
  slaBusinessDays: number | null;
  externalPartyContactIds: string[];
  externalPartyText: string | null;
  requiredSystemIds: string[];
  /// Spec 3.9: the permission each needs, by system id.
  requiredSystemPermissions?: Record<string, string>;
  executorUserId?: string | null;
  executorContactId?: string | null;
  approverText: string | null;
  approverUserId: string | null;
  approverContactId: string | null;
  approvalPolicyIds: string[];
  approvalText: string | null;
  exceptionPlaybook: string | null;
  entityId: string | null;
  businessCalendar: string | null;
  executorText: string | null;
  /// Linked executor's name, and the systems with their permissions, as read.
  executorName?: string | null;
  systemsLine?: string | null;
  transitionStatus: TransitionLike;
  knowledgeStatus: KnowledgeStatusLike;
  toResolve: string | null;
  sources: string[];
  score: number;
  gaps: string[];
  nextDate: string | null;
  dateIds: string[];
  latestVersion: number;
  current: { version: number; steps: ProcessStep[]; highlights: string | null; outputs: string | null; approvedByName: string | null; checks: PanelCheck[]; approvedAt?: string | null; atApproval?: PanelCheck[] | null } | null;
  draft: { version: number; steps: ProcessStep[]; highlights: string | null; outputs: string | null; changeNote: string | null; checks: PanelCheck[] } | null;
  runs: { id: string; title: string; status: string; dueDate: string | null }[];
  /// An ongoing process: its check, when the next one is due, and the last ones.
  checkEveryDays: number | null;
  /// Spec 7.3, 5.4: why it needs review, if it does, and the review period.
  reviewReason: ReviewReason | null;
  reviewEveryDays: number | null;
  reviewDueAt: string | null;
  // The procedure as a document (23.10.2026).
  scope?: string | null;
  definitions?: string | null;
  controlRefs?: string[];
  classification?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL";
  relatedDocs?: string | null;
  checkEvery: string | null;
  checkText: string | null;
  checkDue: { key: string; state: CheckState } | null;
  routine: boolean;
  checks: { id: string; outcome: "OK" | "ISSUE"; note: string | null; createdAt: string; checkedByName: string | null; taskId: string | null }[];
  /// Spec 5.4: what people who closed runs said about the procedure.
  lessons: PanelLesson[];
};

export type PanelLesson = {
  id: string;
  status: LessonStatusLike;
  body: string | null;
  version: number | null;
  taskId: string;
  runTitle: string | null;
  authorName: string | null;
  createdAt: string;
  resolution: string | null;
  resolvedByName: string | null;
};

function ResolveLessonForm({ clientId, lesson }: { clientId: string; lesson: PanelLesson }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(resolveLessonAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={lesson.id} />
      <p className="text-sm text-app-text-primary">{lesson.body}</p>
      <Field label="מה קרה איתה">
        <select name="status" defaultValue="APPLIED" className={INPUT}>
          <option value="APPLIED">{LESSON_STATUS_LABELS.APPLIED}</option>
          <option value="DISMISSED">{LESSON_STATUS_LABELS.DISMISSED}</option>
        </select>
      </Field>
      <Field label="במשפט אחד *">
        <input name="resolution" required placeholder="גרסה 4, שלב 2" className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "שמירה"}
      </button>
    </form>
  );
}

function Lessons({ clientId, lessons, canResolve }: { clientId: string; lessons: PanelLesson[]; canResolve: boolean }) {
  const open = lessons.filter((l) => l.status === "OPEN");
  const done = lessons.filter((l) => l.status !== "OPEN");
  if (lessons.length === 0) return null;
  return (
    <div className="mt-2">
      {open.length > 0 && (
        <div className="rounded-lg border border-gold/40 bg-gold/[0.04] p-2.5">
          <p className="text-xs font-medium text-app-text-primary">{open.length === 1 ? "הערה אחת מריצות, לגרסה הבאה" : `${open.length} הערות מריצות, לגרסה הבאה`}</p>
          <ul className="mt-1.5 space-y-1.5">
            {open.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 text-app-text-primary">
                  {l.body}
                  <span className="text-app-text-tertiary">
                    {" "}
                    ({[l.authorName, day(l.createdAt), l.version ? `גרסה ${l.version}` : null].filter(Boolean).join(" · ")},{" "}
                    <Link href={`/app/tasks/${l.taskId}`} className="text-app-text-accent hover:underline">
                      לריצה
                    </Link>
                    )
                  </span>
                </span>
                {canResolve && (
                  <Drawer triggerLabel="החלטה" title="הערה על הנוהל" variant="link">
                    <ResolveLessonForm clientId={clientId} lesson={l} />
                  </Drawer>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {done.length > 0 && (
        <details className="mt-1.5 text-xs text-app-text-secondary">
          <summary className="cursor-pointer">{done.length === 1 ? "הערה אחת שטופלה" : `${done.length} הערות שטופלו`}</summary>
          <ul className="mt-1 space-y-1">
            {done.map((l) => (
              <li key={l.id}>
                {l.body} · {LESSON_STATUS_LABELS[l.status]}
                {l.resolution && `: ${l.resolution}`}
                {l.resolvedByName && ` (${l.resolvedByName})`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/// A check a procedure faces (R1 to R4, and the client's rules). BLOCK
/// never passes; EXCEPTION passes while the rule has an approved exception.
export type PanelCheck = { code: string; message: string; severity: "BLOCK" | "EXCEPTION"; excepted?: boolean };

function CheckLines({ checks }: { checks: PanelCheck[] }) {
  return (
    <>
      {checks.map((c, i) => (
        <p key={i} className={`mt-1 text-xs ${c.excepted ? "text-app-text-tertiary" : "text-app-error"}`}>
          {c.message}
          {c.severity === "EXCEPTION" && (c.excepted ? " (יש חריגה מאושרת לכלל.)" : " אפשר לאשר רק עם חריגה מאושרת לכלל.")}
        </p>
      ))}
    </>
  );
}

const TONE: Record<TransitionLike, "green" | "amber" | "gray"> = { WITH_ANKORA: "green", IN_HANDOVER: "amber", WITH_CLIENT: "gray", NOT_PLANNED: "gray" };

function day(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}

function Checks({ name, options, selected }: { name: string; options: Option[]; selected: string[] }) {
  if (options.length === 0) return <p className="mt-1 text-[11px] text-app-text-tertiary">אין עדיין בתיק.</p>;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-1.5 text-sm text-app-text-primary">
          <input type="checkbox" name={name} value={o.id} defaultChecked={selected.includes(o.id)} className="h-4 w-4 accent-gold" />
          {o.name}
        </label>
      ))}
    </div>
  );
}

/// Spec 3.9: the systems a process needs, each with the permission it
/// needs there.
function SystemChecks({ options, selected, permissions }: { options: Option[]; selected: string[]; permissions: Record<string, string> }) {
  const [on, setOn] = useState<string[]>(selected);
  if (options.length === 0) return <p className="mt-1 text-[11px] text-app-text-tertiary">אין עדיין בתיק.</p>;
  return (
    <div className="mt-1.5 space-y-1.5">
      {options.map((o) => (
        <div key={o.id} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-app-text-primary">
            <input
              type="checkbox"
              name="requiredSystemIds"
              value={o.id}
              checked={on.includes(o.id)}
              onChange={(e) => setOn((cur) => (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))}
              className="h-4 w-4 accent-gold"
            />
            {o.name}
          </label>
          {on.includes(o.id) && (
            <input name={`systemPermission:${o.id}`} defaultValue={permissions[o.id] ?? ""} placeholder="איזו הרשאה צריך" aria-label={`הרשאה ב-${o.name}`} className={INPUT} />
          )}
        </div>
      ))}
    </div>
  );
}

function ProcessForm({
  clientId,
  existing,
  staff,
  contacts,
  systems,
  rules,
  entities,
  sourceOptions,
}: {
  clientId: string;
  existing?: PanelProcess;
  staff: Option[];
  contacts: Option[];
  systems: Option[];
  rules: Option[];
  entities: EntityOption[];
  sourceOptions: SourceOption[];
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateProcessAction : addProcessAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.knowledgeStatus ?? "CONFIRMED");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label="שם התהליך *">
        <input name="title" required defaultValue={existing?.title ?? ""} placeholder="תשלומי ספקים, LTD" className={INPUT} />
      </Field>
      <Field label="למה הוא קיים">
        <input name="purpose" defaultValue={existing?.purpose ?? ""} className={INPUT} />
      </Field>
      <fieldset>
        <legend className={LABEL}>מה מפעיל אותו</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {(Object.keys(TRIGGER_LABELS) as TriggerLike[]).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm text-app-text-primary">
              <input type="checkbox" name="triggerKinds" value={t} defaultChecked={existing?.triggerKinds.includes(t)} className="h-4 w-4 accent-gold" />
              {TRIGGER_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="הטריגר במילים">
        <input name="triggerText" defaultValue={existing?.triggerText ?? ""} placeholder="פעמיים בחודש, ב-10 וב-25" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="בעלים">
          <select name="ownerId" defaultValue={existing?.ownerId ?? ""} className={INPUT}>
            <option value="">לא נקבע</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="מחליף (לא חובה)">
          <select name="backupOwnerId" defaultValue={existing?.backupOwnerId ?? ""} className={INPUT}>
            <option value="">אין</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field label="SLA">
          <input name="slaText" defaultValue={existing?.slaText ?? ""} placeholder="החומר אצל איילה יומיים עסקים לפני" className={INPUT} />
        </Field>
        <Field label="ימי עסקים">
          <input name="slaBusinessDays" inputMode="numeric" defaultValue={existing?.slaBusinessDays ?? ""} className={INPUT} />
        </Field>
      </div>
      <div>
        <span className={LABEL}>מערכות</span>
        <SystemChecks options={systems} selected={existing?.requiredSystemIds ?? []} permissions={existing?.requiredSystemPermissions ?? {}} />
      </div>
      <div>
        <span className={LABEL}>גורם חיצוני</span>
        <Checks name="externalPartyContactIds" options={contacts} selected={existing?.externalPartyContactIds ?? []} />
        <input name="externalPartyText" defaultValue={existing?.externalPartyText ?? ""} placeholder='Nextage, או "אין"' className={INPUT} />
      </div>
      <div>
        <span className={LABEL}>מי מאשר שלב שדורש אישור</span>
        <div className="grid grid-cols-2 gap-3">
          <select name="approverUserId" defaultValue={existing?.approverUserId ?? ""} aria-label="מאשר באנקורה" className={INPUT}>
            <option value="">אף אחד באנקורה</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (מאשר במערכת)
              </option>
            ))}
          </select>
          <select name="approverContactId" defaultValue={existing?.approverContactId ?? ""} aria-label="מאשר אצל הלקוח" className={INPUT}>
            <option value="">אף אחד אצל הלקוח</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-[11px] text-app-text-tertiary">מאשר באנקורה חותם במערכת: השלב מחכה לו, והריצה לא נסגרת לפניו. מאשר אצל הלקוח מופיע בשם, והאישור ממנו נאסף בחוץ.</p>
        <input name="approverText" defaultValue={existing?.approverText ?? ""} placeholder="או במילים: מורשה חתימה בבנק" className={INPUT} />
      </div>
      <div>
        <span className={LABEL}>ספי אישור</span>
        <Checks name="approvalPolicyIds" options={rules} selected={existing?.approvalPolicyIds ?? []} />
        <input name="approvalText" defaultValue={existing?.approvalText ?? ""} placeholder='ספק חדש: אישור רו"ח, או "אין"' className={INPUT} />
      </div>
      <Field label="סקירת הנוהל כל (ימים)">
        <input name="reviewEveryDays" inputMode="numeric" defaultValue={existing?.reviewEveryDays ?? ""} placeholder="90" className={INPUT} />
      </Field>
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <Field label="בדיקה כל (ימים)">
          <input name="checkEveryDays" inputMode="numeric" defaultValue={existing?.checkEveryDays ?? ""} placeholder="7" className={INPUT} />
        </Field>
        <Field label="מה בודקים (לתהליך שוטף)">
          <input name="checkText" defaultValue={existing?.checkText ?? ""} placeholder="שאין חשבוניות תקועות" className={INPUT} />
        </Field>
      </div>
      <Field label="נוהל חריגים">
        <textarea name="exceptionPlaybook" rows={3} defaultValue={existing?.exceptionPlaybook ?? ""} placeholder="מה עושים כשמשהו חורג" className={INPUT} />
      </Field>
      <details className="rounded-lg border border-app-border px-3 py-2" open={!!(existing?.scope || existing?.definitions || existing?.controlRefs?.length || existing?.relatedDocs)}>
        <summary className="cursor-pointer text-xs font-medium text-app-text-secondary">למסמך הנוהל (תחולה, הגדרות, בקרות)</summary>
        <p className="mt-1 text-[11px] text-app-text-tertiary">מה שנוהל SOC 2 צריך ואין בשדות למעלה. נכנס למסמך שמייצאים ללקוח או למבקר, וננעל עם כל גרסה מאושרת.</p>
        <div className="mt-2 space-y-3">
          <Field label="תחולה">
            <textarea name="scope" rows={2} defaultValue={existing?.scope ?? ""} placeholder="על מי ועל מה הנוהל חל, ועל מה לא" className={INPUT} />
          </Field>
          <Field label="הגדרות (מונח: הסבר, שורה לכל מונח)">
            <textarea name="definitions" rows={2} defaultValue={existing?.definitions ?? ""} placeholder="Offboarding: עזיבת עובד" className={INPUT} />
          </Field>
          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <Field label="בקרות (מופרדות בפסיק)">
              <input name="controlRefs" dir="ltr" defaultValue={existing?.controlRefs?.join(", ") ?? ""} placeholder="CC6.2, CC6.3" className={INPUT} />
            </Field>
            <Field label="סיווג">
              <select name="classification" defaultValue={existing?.classification ?? "CONFIDENTIAL"} className={INPUT}>
                <option value="CONFIDENTIAL">סודי</option>
                <option value="INTERNAL">פנימי</option>
                <option value="PUBLIC">ציבורי</option>
              </select>
            </Field>
          </div>
          <Field label="מסמכים קשורים">
            <textarea name="relatedDocs" rows={2} defaultValue={existing?.relatedDocs ?? ""} placeholder="מדיניות בקרת גישה, נוהל קליטת עובד" className={INPUT} />
          </Field>
        </div>
      </details>
      <EntitySelect entities={entities} defaultValue={existing?.entityId} />
      <Field label="לוח ימי עבודה">
        <select name="businessCalendar" defaultValue={existing?.businessCalendar ?? ""} aria-label="לוח ימי עבודה" className={INPUT}>
          <option value="">לפי המדינה של הישות</option>
          {BUSINESS_CALENDARS.map((c) => (
            <option key={c} value={c}>
              {BUSINESS_CALENDAR_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-app-text-tertiary">הריצות והמועדים שפותחים את התהליך נספרים לפיו.</span>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="מי מבצע היום">
          <select name="executorUserId" defaultValue={existing?.executorUserId ?? ""} aria-label="מבצע באנקורה" className={INPUT}>
            <option value="">אף אחד באנקורה</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select name="executorContactId" defaultValue={existing?.executorContactId ?? ""} aria-label="מבצע אצל הלקוח" className={`${INPUT} mt-1.5`}>
            <option value="">אף אחד אצל הלקוח</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input name="executorText" defaultValue={existing?.executorText ?? ""} placeholder="או במילים: גיא" className={`${INPUT} mt-1.5`} />
        </Field>
        <Field label="איפה בחפיפה">
          <select name="transitionStatus" defaultValue={existing?.transitionStatus ?? "WITH_CLIENT"} className={INPUT}>
            {(Object.keys(TRANSITION_LABELS) as TransitionLike[]).map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="מה ידוע על התהליך">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.knowledgeStatus === "CONFIRMED"} />
      <ItemExtras existing={existing} owner={false} disclose audience />
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

const EMPTY_STEP: ProcessStep = { title: "", mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null };

function ProcedureEditor({ clientId, process, systems }: { clientId: string; process: PanelProcess; systems: Option[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveProcessVersionAction, close);
  const start = process.draft ?? process.current;
  const [steps, setSteps] = useState<ProcessStep[]>(start?.steps.length ? start.steps : [{ ...EMPTY_STEP }]);
  const set = (i: number, patch: Partial<ProcessStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((all) => {
      const next = [...all];
      const j = i + d;
      if (j < 0 || j >= next.length) return all;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <input type="hidden" name="baseVersion" value={process.latestVersion} />
      <input type="hidden" name="steps" value={JSON.stringify(steps.filter((s) => s.title.trim()))} />
      <p className="text-xs text-app-text-secondary">
        נשמר כגרסה {process.latestVersion + 1}, טיוטה. מנהל מאשר, והבדיקות רצות לפני האישור.
      </p>
      <ol className="flex flex-col gap-3">
        {steps.map((st, i) => (
          <li key={i} className="rounded-lg border border-app-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-app-text-secondary">שלב {i + 1}</span>
              <span className="flex gap-2 text-xs text-app-text-tertiary">
                <button type="button" onClick={() => move(i, -1)} aria-label={`הזזת שלב ${i + 1} למעלה`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} aria-label={`הזזת שלב ${i + 1} למטה`}>
                  ↓
                </button>
                <button type="button" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} className="hover:text-app-error">
                  הסרת שלב
                </button>
              </span>
            </div>
            <input aria-label={`שלב ${i + 1}: מה עושים`} value={st.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="מה עושים" className={INPUT} />
            <div className="mt-2 grid grid-cols-[1fr_7rem] gap-2">
              <select aria-label={`שלב ${i + 1}: איך`} value={st.mode} onChange={(e) => set(i, { mode: e.target.value as StepModeLike })} className={INPUT}>
                {(Object.keys(STEP_MODE_LABELS) as StepModeLike[]).map((m) => (
                  <option key={m} value={m}>
                    {STEP_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              <input
                aria-label={`שלב ${i + 1}: ימי עסקים מהמועד`}
                inputMode="numeric"
                value={st.offsetBusinessDays ?? ""}
                onChange={(e) => set(i, { offsetBusinessDays: /^-?\d+$/.test(e.target.value) ? Number(e.target.value) : null })}
                placeholder="ימים, -2"
                className={INPUT}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {ACTION_TAGS.map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs text-app-text-secondary">
                  <input
                    type="checkbox"
                    checked={st.actionTags.includes(t)}
                    onChange={(e) => set(i, { actionTags: e.target.checked ? [...st.actionTags, t] : st.actionTags.filter((x: ActionTag) => x !== t) })}
                    className="h-3.5 w-3.5 accent-gold"
                  />
                  {ACTION_TAG_LABELS[t]}
                </label>
              ))}
            </div>
            {systems.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {systems.map((s) => (
                  <label key={s.id} className="flex items-center gap-1 text-xs text-app-text-secondary">
                    <input
                      type="checkbox"
                      checked={st.systemIds.includes(s.id)}
                      onChange={(e) => set(i, { systemIds: e.target.checked ? [...st.systemIds, s.id] : st.systemIds.filter((x) => x !== s.id) })}
                      className="h-3.5 w-3.5 accent-gold"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
            <input value={st.output ?? ""} onChange={(e) => set(i, { output: e.target.value || null })} placeholder="מה נוצר בסוף השלב" className={INPUT} />
            {st.actionTags.some((t) => MONEY_TAGS.includes(t)) && (
              <div className="mt-2 grid grid-cols-[1fr_6rem] gap-2">
                <input
                  aria-label={`שלב ${i + 1}: סכום מרבי`}
                  inputMode="decimal"
                  value={st.amountMaxMinor === null ? "" : String(st.amountMaxMinor / 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/,/g, ""));
                    set(i, { amountMaxMinor: e.target.value.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null });
                  }}
                  placeholder="סכום מרבי, אם ידוע"
                  className={INPUT}
                />
                <select aria-label={`שלב ${i + 1}: מטבע`} value={st.currency ?? ""} onChange={(e) => set(i, { currency: e.target.value || null })} className={INPUT}>
                  <option value="">מטבע</option>
                  {["ILS", "USD", "EUR"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {st.actionTags.includes("CLIENT_MESSAGE") && (
              <select aria-label={`שלב ${i + 1}: ערוץ`} value={st.channel ?? ""} onChange={(e) => set(i, { channel: (e.target.value || null) as Channel | null })} className={`mt-2 ${INPUT}`}>
                <option value="">באיזה ערוץ ההודעה יוצאת</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
            {st.mode === "AUTOMATED" && (
              <input value={st.verification ?? ""} onChange={(e) => set(i, { verification: e.target.value || null })} placeholder="איך אדם מוודא שזה קרה *" className={INPUT} />
            )}
            <label className="mt-2 flex items-center gap-1.5 text-xs text-app-text-primary">
              <input type="checkbox" checked={st.requiresApproval} onChange={(e) => set(i, { requiresApproval: e.target.checked })} className="h-4 w-4 accent-gold" />
              דורש אישור לפני ביצוע
            </label>
          </li>
        ))}
      </ol>
      {steps.length < MAX_PROCESS_STEPS && (
        <button type="button" onClick={() => setSteps((all) => [...all, { ...EMPTY_STEP }])} className="self-start text-xs text-app-text-accent hover:underline">
          + שלב
        </button>
      )}
      <Field label="דגשים">
        <textarea name="highlights" rows={2} defaultValue={start?.highlights ?? ""} placeholder="רישום ותשלום הם שני ערוצים נפרדים" className={INPUT} />
      </Field>
      <Field label="מה חייב להיווצר כדי שהריצה תיחשב גמורה">
        <input name="outputs" defaultValue={start?.outputs ?? ""} className={INPUT} />
      </Field>
      <Field label="מה השתנה ולמה">
        <input name="changeNote" className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "שמירת טיוטה"}
      </button>
    </form>
  );
}

function DatesForm({ clientId, process, dates }: { clientId: string; process: PanelProcess; dates: Option[] }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(linkProcessDatesAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <p className="text-xs text-app-text-secondary">המועדים של הלקוח שמפעילים את התהליך. ריצה תיפתח מהם כשהנוהל מאושר.</p>
      <Checks name="dateIds" options={dates} selected={process.dateIds} />
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "שמירה"}
      </button>
    </form>
  );
}

function StartRunForm({ clientId, process }: { clientId: string; process: PanelProcess }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(startProcessRunAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <p className="text-xs text-app-text-secondary">
        נפתחת משימה עם {process.current?.steps.length ?? 0} השלבים של נוהל גרסה {process.current?.version}, כל אחד ביום העסקים שלו.
      </p>
      <Field label="לאיזה יום *">
        <input name="day" type="date" required className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "פותח..." : "פתיחת הריצה"}
      </button>
    </form>
  );
}

function StepList({ steps, systemName }: { steps: ProcessStep[]; systemName: Map<string, string> }) {
  return (
    <ol className="mt-1.5 space-y-1.5">
      {steps.map((st, i) => (
        <li key={i} className="text-xs text-app-text-primary">
          <span className="font-medium">
            {i + 1}. {st.title}
          </span>
          <span className="text-app-text-tertiary">
            {" · "}
            {STEP_MODE_LABELS[st.mode]}
            {st.offsetBusinessDays !== null && ` · ${st.offsetBusinessDays >= 0 ? `+${st.offsetBusinessDays}` : st.offsetBusinessDays} ימי עסקים`}
            {st.actionTags.length > 0 && ` · ${st.actionTags.map((t) => ACTION_TAG_LABELS[t]).join(", ")}`}
            {st.systemIds.length > 0 && ` · ${st.systemIds.map((id) => systemName.get(id) ?? "מערכת שהוסרה").join(", ")}`}
            {st.amountMaxMinor !== null && st.currency && ` · עד ${formatAmount(st.amountMaxMinor, st.currency)}`}
            {st.channel && ` · ב${CHANNEL_LABELS[st.channel]}`}
            {st.requiresApproval && " · דורש אישור"}
          </span>
          {st.verification && <span className="block text-app-text-tertiary">אימות: {st.verification}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ProcessesPanel({
  clientId,
  processes,
  staff,
  contacts,
  systems,
  rules,
  dates,
  entities,
  sourceOptions,
  canApprove,
  userId,
}: {
  clientId: string;
  /// Who is looking: a process's owner decides on its lessons.
  userId?: string;
  processes: PanelProcess[];
  staff: Option[];
  contacts: Option[];
  systems: Option[];
  rules: Option[];
  dates: Option[];
  entities: EntityOption[];
  sourceOptions: SourceOption[];
  canApprove: boolean;
}) {
  const { showToast } = useToast();
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const withUs = processes.filter((p) => p.transitionStatus === "WITH_ANKORA").length;
  const handover = processes.filter((p) => p.transitionStatus === "IN_HANDOVER").length;
  const avg = processes.length ? Math.round((processes.reduce((a, p) => a + p.score, 0) / processes.length) * 10) / 10 : 0;

  async function act(fn: () => Promise<{ error?: string }>, ok: string) {
    const r = await fn();
    if (r.error) showToast({ tone: "error", title: "הפעולה נכשלה", description: r.error });
    else showToast({ tone: "success", title: ok });
  }

  const form = { staff, contacts, systems, rules, entities, sourceOptions };
  return (
    <div id="processes" className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">תהליכים ({processes.length})</h2>
        <div className="flex items-center gap-4">
          {processes.some((p) => p.current) && (
            <Link href={`/app/clients/${clientId}/procedures`} className="text-xs font-medium text-app-text-accent hover:underline" data-testid="procedures-index-link">
              הנהלים כמסמכים
            </Link>
          )}
          <Drawer triggerLabel="+ תהליך" title="תהליך" variant="link">
            <ProcessForm clientId={clientId} {...form} />
          </Drawer>
        </div>
      </div>
      {processes.length > 0 && (
        <p className="mt-1 text-[11px] text-app-text-tertiary">
          {withUs} אצלנו · {handover} בחפיפה · שלמות ממוצעת {avg} מתוך 9
        </p>
      )}
      {processes.length === 0 ? (
        <p className="mt-2 text-sm text-app-text-tertiary">אין עדיין תהליכים. מה חוזר אצל הלקוח, מי אחראי, מה מפעיל את זה, ואיך עושים את זה.</p>
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {processes.map((p) => (
            <ProcessCard key={p.id} p={p} clientId={clientId} userId={userId} canApprove={canApprove} staffName={staffName} systemName={systemName} systems={systems} dates={dates} form={form} act={act} />
          ))}
        </ul>
      )}
    </div>
  );
}

type FormOptions = { staff: Option[]; contacts: Option[]; systems: Option[]; rules: Option[]; entities: EntityOption[]; sourceOptions: SourceOption[] };

/// The facts next steps read, from what the card already has.
function factsOf(p: PanelProcess): ProcessFacts {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    purpose: p.purpose,
    status: p.status,
    triggerKinds: p.triggerKinds,
    ownerId: p.ownerId,
    hasNextDate: !!p.nextDate,
    draft: p.draft ? { version: p.draft.version, blocked: !p.draft.checks.every((c) => c.excepted) } : null,
    covered: (p.covered ?? []).map((t) => ({ taskId: t.taskId, title: t.title })),
    missing: p.missing ?? [],
    noAccess: (p.noAccess ?? []).map((x) => x.name),
    review: p.reviewReason ? { label: REVIEW_REASON_LABELS[p.reviewReason], periodic: p.reviewReason === "PERIODIC" } : null,
    openLessons: p.lessons.filter((l) => l.status === "OPEN").length,
    knowledge: { uncertain: p.knowledgeStatus === "UNCERTAIN" || p.knowledgeStatus === "MISSING", toResolve: p.toResolve },
    dateCandidate: p.dateCandidate ?? null,
  };
}

/// One process (22.10.2026): what it is in a line, the step it waits on
/// with what is recommended and a button, the rest of its gaps as a list
/// to tick off, and everything else under "פרטים", closed unless a draft
/// waits or the link led here.
function ProcessCard({
  p,
  clientId,
  userId,
  canApprove,
  staffName,
  systemName,
  systems,
  dates,
  form,
  act,
}: {
  p: PanelProcess;
  clientId: string;
  userId?: string;
  canApprove: boolean;
  staffName: Map<string, string>;
  systemName: Map<string, string>;
  systems: Option[];
  dates: Option[];
  form: FormOptions;
  act: (fn: () => Promise<{ error?: string }>, ok: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(!!p.draft);
  useEffect(() => {
    // Arriving on this process by its link opens it.
    const check = () => {
      if (window.location.hash === `#item-${p.id}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [p.id]);
  const steps = nextSteps(factsOf(p), canApprove);
  const [first, ...rest] = steps;

  const fixButton = (step: NextStep, primary: boolean) => {
    const cls = primary ? "rounded-full bg-app-surface-nav px-3 py-1 text-[12px] font-medium text-cream" : "text-[12px] font-medium text-app-text-accent hover:underline";
    const f = step.fix;
    if (f.kind === "op") {
      return (
        <button type="button" onClick={() => act(() => runProcessStepAction(f.op, clientId), "בוצע")} className={cls} data-testid="step-op">
          {f.label}
        </button>
      );
    }
    if (f.kind === "edit") {
      return (
        <Drawer triggerLabel={f.label} title={`עריכה: ${p.code} ${p.title}`} variant="link">
          <ProcessForm clientId={clientId} existing={p} {...form} />
        </Drawer>
      );
    }
    if (f.kind === "procedure") {
      return (
        <Drawer triggerLabel={f.label} title={`נוהל: ${p.code} ${p.title}`} variant="link">
          <ProcedureEditor clientId={clientId} process={p} systems={systems} />
        </Drawer>
      );
    }
    if (f.kind === "dates") {
      return (
        <Drawer triggerLabel={f.label} title={`מועדים: ${p.code} ${p.title}`} variant="link">
          <DatesForm clientId={clientId} process={p} dates={dates} />
        </Drawer>
      );
    }
    return (
      <button type="button" onClick={() => setOpen(true)} className={cls}>
        {f.label}
      </button>
    );
  };

  return (
    <li id={`item-${p.id}`} className="py-4 scroll-mt-24 rounded-lg target:bg-app-accent-soft" data-testid="process-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-app-text-tertiary">{p.code}</span>
            <p className="text-sm font-medium text-app-text-primary">{p.title}</p>
            <StatusBadge label={TRANSITION_LABELS[p.transitionStatus]} tone={TONE[p.transitionStatus]} />
            {p.status !== "ACTIVE" && <StatusBadge label={p.status === "DRAFT" ? "אין נוהל מאושר" : p.status === "PAUSED" ? "מושהה" : "בוטל"} tone="gray" />}
            <span className={`text-xs ${p.score >= 8 ? "text-app-success" : "text-app-warning"}`}>{p.score} מתוך 9</span>
            {p.reviewReason && <StatusBadge label="דורש סקירה" tone="red" />}
          </div>
          <p className="mt-1 text-xs text-app-text-secondary">
            {[
              p.triggerKinds.map((t) => TRIGGER_LABELS[t]).join(", ") || null,
              p.ownerId ? `בעלים: ${staffName.get(p.ownerId) ?? ""}` : null,
              p.backupOwnerId ? `מחליף: ${staffName.get(p.backupOwnerId) ?? ""}` : null,
              p.nextDate ? `הבא: ${day(p.nextDate)}` : null,
              p.lastRunAt ? `ריצה אחרונה: ${day(p.lastRunAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {first ? (
            <div className={`mt-2 rounded-lg px-3 py-2 ${first.blocking ? "bg-app-error-soft" : "bg-app-warning-soft"}`} data-testid="process-next-step" data-step={first.kind}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-xs text-app-text-primary">
                  <span className="font-medium">הצעד הבא: </span>
                  {first.title}
                </p>
                {fixButton(first, true)}
              </div>
              {first.recommend && (
                <p className="mt-0.5 text-[11.5px] text-app-text-secondary">
                  מומלץ: {first.recommend}.{first.why && ` ${first.why}`}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs font-medium text-app-success" data-testid="process-next-step" data-step="none">
              תקין: אין כרגע מה לסגור בתהליך.
            </p>
          )}

          {rest.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="process-checklist">
              {rest.map((st) => (
                <li key={st.kind} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-app-text-primary">
                    <span aria-hidden className="me-1.5 inline-block h-3 w-3 rounded-sm border border-app-border-strong align-middle" />
                    {st.title}
                    {st.recommend && <span className="text-app-text-tertiary"> · מומלץ: {st.recommend}</span>}
                  </span>
                  {fixButton(st, false)}
                </li>
              ))}
            </ul>
          )}

          <details className="mt-2" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="process-details">
            <summary className="cursor-pointer text-xs font-medium text-app-text-secondary hover:text-app-text-primary">פרטים</summary>
            <div className="mt-1.5">
              <p className="text-xs text-app-text-secondary">
                {[
                  p.triggerText,
                  p.executorName || p.executorText ? `מבצע היום: ${p.executorName ?? p.executorText}` : null,
                  p.systemsLine ? `מערכות: ${p.systemsLine}` : null,
                  p.reviewReason ? `${REVIEW_REASON_LABELS[p.reviewReason]}${p.reviewReason === "PERIODIC" && p.reviewEveryDays ? ` (כל ${p.reviewEveryDays} ימים)` : ""}` : null,
                  !p.reviewReason && p.reviewDueAt ? `סקירה הבאה: ${day(p.reviewDueAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <StatusLine status={p.knowledgeStatus} toResolve={p.toResolve} />
              <ItemTags item={{ clientVisible: p.clientVisible, doNotDisclose: p.doNotDisclose, refs: p.refs, verifiedAt: p.verifiedAt }} disclose />
              <SourceCodes sources={p.sources} options={form.sourceOptions} />
              <Body p={p} clientId={clientId} userId={userId} canApprove={canApprove} systemName={systemName} />
            </div>
          </details>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-xs">
          {p.latestVersion > 0 && (
            <Link href={`/app/clients/${clientId}/processes/${p.id}/document`} className="font-medium text-app-text-accent hover:underline" data-testid="procedure-document-link">
              מסמך הנוהל
            </Link>
          )}
          <Drawer triggerLabel="עריכה" title={`עריכה: ${p.code} ${p.title}`} variant="link">
            <ProcessForm clientId={clientId} existing={p} {...form} />
          </Drawer>
          <Drawer triggerLabel={p.draft ? "עריכת הטיוטה" : p.current ? "גרסה חדשה לנוהל" : "כתיבת נוהל"} title={`נוהל: ${p.code} ${p.title}`} variant="link">
            <ProcedureEditor clientId={clientId} process={p} systems={systems} />
          </Drawer>
          {p.status === "ACTIVE" && p.triggerKinds.some((t) => t !== "CONTINUOUS") && (
            <Drawer triggerLabel="פתיחת ריצה" title={`ריצה: ${p.code} ${p.title}`} variant="link">
              <StartRunForm clientId={clientId} process={p} />
            </Drawer>
          )}
          {p.routine && (
            <Drawer triggerLabel="רישום בדיקה" title={`בדיקה: ${p.code} ${p.title}`} variant="link">
              <ProcessCheckForm clientId={clientId} processId={p.id} checkText={p.checkText} steps={p.current?.steps.map((st) => st.title) ?? []} />
            </Drawer>
          )}
          {p.triggerKinds.includes("SCHEDULED") && (
            <Drawer triggerLabel="מועדים" title={`מועדים: ${p.code} ${p.title}`} variant="link">
              <DatesForm clientId={clientId} process={p} dates={dates} />
            </Drawer>
          )}
          {canApprove && p.status === "ACTIVE" && (
            <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "PAUSED", clientId), "התהליך הושהה")} className="text-app-text-tertiary hover:text-app-text-primary">
              השהיה
            </button>
          )}
          {canApprove && p.status === "PAUSED" && (
            <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "ACTIVE", clientId), "התהליך חודש")} className="text-app-text-tertiary hover:text-app-text-primary">
              חידוש
            </button>
          )}
          {p.status === "DRAFT" && (
            <button type="button" onClick={() => act(() => removeProcessAction(p.id, clientId), "התהליך הוסר")} className="text-app-text-tertiary hover:text-app-error">
              הסרה
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/// Under "פרטים": the procedure in force, its runs, the remarks from runs,
/// the checks of an ongoing process, and a draft waiting for approval.
function Body({
  p,
  clientId,
  userId,
  canApprove,
  systemName,
}: {
  p: PanelProcess;
  clientId: string;
  userId?: string;
  canApprove: boolean;
  systemName: Map<string, string>;
}) {
  return (
    <>
      {p.current ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-app-text-secondary">
            נוהל, גרסה {p.current.version}
            {p.current.approvedByName && `, אושר על ידי ${p.current.approvedByName}`}
            {p.current.approvedAt && ` ב-${day(p.current.approvedAt)}`}
          </p>
          {p.current.atApproval && (
            <div className="mt-0.5" data-testid="approval-checks">
              <p className="text-[11px] text-app-text-tertiary">
                {p.current.atApproval.length === 0
                  ? "באישור: עמד בכל הכללים של הלקוח."
                  : `באישור: ${p.current.atApproval.length === 1 ? "חריגה אחת מאושרת" : `${p.current.atApproval.length} חריגות מאושרות`}.`}
              </p>
              {p.current.atApproval.length > 0 && <CheckLines checks={p.current.atApproval} />}
            </div>
          )}
          <StepList steps={p.current.steps} systemName={systemName} />
          {p.current.highlights && <p className="mt-1 text-xs text-app-text-secondary">דגשים: {p.current.highlights}</p>}
          {p.current.checks.some((c) => !c.excepted) && (
            <div className="mt-1.5 rounded-lg border border-app-error/30 bg-app-error-soft px-3 py-2">
              <p className="text-xs font-medium text-app-error">הנוהל שבתוקף לא עומד היום בכללים של הלקוח. כותבים גרסה חדשה, או מבקשים חריגה.</p>
              <CheckLines checks={p.current.checks.filter((c) => !c.excepted)} />
            </div>
          )}
        </div>
      ) : (
        !p.draft && <p className="mt-2 text-xs text-app-text-tertiary">עוד אין נוהל.</p>
      )}

      {p.runs.length > 0 && (
        <p className="mt-1.5 text-xs text-app-text-secondary">
          ריצות:{" "}
          {p.runs.map((r, i) => (
            <span key={r.id}>
              {i > 0 && " · "}
              <Link href={`/app/tasks/${r.id}`} className="text-app-text-accent hover:underline">
                {r.dueDate ? day(r.dueDate) : r.title}
              </Link>
              {r.status === "DONE" && " (בוצע)"}
            </span>
          ))}
        </p>
      )}

      <Lessons clientId={clientId} lessons={p.lessons} canResolve={canApprove || (!!userId && p.ownerId === userId)} />

      {p.checkEvery && (
        <p className="mt-1.5 text-xs text-app-text-secondary">
          בדיקה {p.checkEvery}
          {p.checkText && `: ${p.checkText}`}
          {p.checkDue && (
            <span className={p.checkDue.state === "LATER" ? "text-app-text-tertiary" : "text-app-warning"}>
              {" · "}
              {p.checkDue.state === "LATER" ? `הבאה ב-${day(p.checkDue.key)}` : `${CHECK_STATE_LABELS[p.checkDue.state]}${p.checkDue.state === "OVERDUE" ? `, מ-${day(p.checkDue.key)}` : ""}`}
            </span>
          )}
        </p>
      )}
      {p.checks.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {p.checks.map((c) => (
            <li key={c.id} className={`text-xs ${c.outcome === "ISSUE" ? "text-app-warning" : "text-app-text-secondary"}`}>
              {day(c.createdAt)}
              {c.checkedByName && `, ${c.checkedByName}`}: {c.outcome === "OK" ? "תקין" : "נמצאה בעיה"}
              {c.note && `. ${c.note}`}
              {c.taskId && (
                <>
                  {" · "}
                  <Link href={`/app/tasks/${c.taskId}`} className="text-app-text-accent hover:underline">
                    המשימה
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {p.draft && (
        <div className="mt-2 rounded-lg border border-app-warning/30 bg-app-warning-soft px-3 py-2">
          <p className="text-xs font-medium text-app-warning">
            טיוטה, גרסה {p.draft.version}
            {p.draft.changeNote && `: ${p.draft.changeNote}`}
          </p>
          <StepList steps={p.draft.steps} systemName={systemName} />
          <CheckLines checks={p.draft.checks} />
          {/* Approved from "הצעד הבא" above, one button for one decision. */}
        </div>
      )}
    </>
  );
}
