"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CenterDialog, Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  ACTION_TAGS,
  CHANNELS,
  MAX_PROCESS_STEPS,
  MONEY_TAGS,
  STEP_MODE_LABELS,
  TRANSITION_LABELS,
  TRIGGER_LABELS,
  blockingChecks,
  type ActionTag,
  type Channel,
  type KeyedCheck,
  type ProcessStep,
  type StepModeLike,
  type TransitionLike,
  type TriggerLike,
} from "@/lib/process-rules";
import {
  addProcessAction,
  linkProcessDatesAction,
  addProcessDateAction,
  removeProcessAction,
  discardProcessVersionAction,
  resolveLessonAction,
  runProcessStepAction,
  restoreProcessFieldAction,
  saveProcessVersionAction,
  setProcessStatusAction,
  startProcessRunAction,
  updateProcessAction,
} from "../process-actions";
import Link from "next/link";
import { formatAmount } from "@/lib/policy-params";
import { REVIEW_REASON_LABELS, type ReviewReason } from "@/lib/process-review";
import { nextSteps, type DateCandidate, type NextStep, type ProcessFacts, type StepOp, type StepText } from "@/lib/next-steps";
import { runBlockerKey } from "@/lib/process-readiness";
import { FIELD_LABELS } from "@/lib/process-rules";
import { type StrangerAskWhoLike, type StrangerSeverityLike, type StrangerState } from "@/lib/stranger-test";
import { type CheckState } from "@/lib/process-checks";
import { ProcessCheckForm } from "./ProcessCheckForm";
import { RhythmEditor, type RhythmEditorProps } from "./RhythmEditor";
import { describeRhythm, type LegacyDate } from "@/lib/process-rhythm";
import { ProcessVisual, ViewSwitch, useProcessView } from "./ProcessVisual";
import { type LessonStatusLike } from "@/lib/process-lessons";
import { EntitySelect, Field, INPUT, LABEL, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption, ItemExtras, ItemTags } from "./knowledge-ui";
import { BUSINESS_CALENDARS } from "@/lib/business-calendar";

// Org brain, phase 1: processes and their procedures, section 7.4 of the
// client file (claude/org-brain-spec-2026-10-12.md, 3.8, 3.9).
//
// A card per process: what triggers it, who owns it, where it stands in
// the handover, how complete it is (Oren's nine fields) and what is
// missing, and the procedure in force. A new procedure is a draft until a
// manager approves it, and the checks that would block it show on the
// draft before anyone presses the button.

type Option = { id: string; name: string };

/// ADR 0006: the panel's words come from `clients.processes`. Some keys
/// are built at runtime (a label by its enum value, a line lib/next-steps
/// names by key), so they are looked up through this loose signature;
/// tests/unit/process-screen-text.test.ts holds them to the dictionary.
type Tx = (key: string, values?: Record<string, string | number>) => string;

export function useTx(): Tx {
  return useTranslations("clients.processes") as unknown as Tx;
}

/// A line lib/next-steps gives as a key, in the reader's language.
function stepText(t: Tx, x: StepText | undefined, fallback: string): string {
  if (!x) return fallback;
  if ("raw" in x) return x.raw;
  const refs = Object.fromEntries(Object.entries(x.refs ?? {}).map(([k, key]) => [k, t(key)]));
  return t(x.key, { ...x.values, ...refs });
}

/// A check lib/process-rules names by key, in the reader's language; the
/// client's own rules (and anything stored before keys existed) keep their
/// message.
export function checkText(t: Tx, c: { message: string; keyed?: KeyedCheck }): string {
  const k = c.keyed;
  if (!k) return c.message;
  return t(`checks.${k.key}`, {
    step: k.step ?? "",
    tags: (k.tags ?? []).map((x) => t(`labels.actionTags.${x}`)).join(", "),
    thresholds: (k.thresholds ?? []).join(", "),
    secrets: (k.secrets ?? []).map((x) => t(`labels.secrets.${x}`)).join(", "),
  });
}

/// A day, as the card has always shown one (12.11.2026), in the reader's
/// language and time zone.
export function useDay(): (iso: string) => string {
  const format = useFormatter();
  return (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric", year: "numeric" });
}

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
  /// 13.11.2026 (stage 1): the rhythm, its starts and its dates.
  triggerNotes?: string | null;
  rhythmStarts?: RhythmEditorProps["starts"];
  rhythmDates?: LegacyDate[];
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
  /// 25.10.2026: will it run, and why not (lib/process-readiness.ts).
  readiness?: { ready: boolean; blocker: string | null };
  /// How well it is written down, less the fields not relevant.
  doc?: { score: number; of: number };
  docMissing?: { field: string; label: string }[];
  notApplicable?: { field: string; label: string }[];
  /// Named in its own words, not linked yet.
  suggestions?: { systems: { id: string; name: string }[]; contacts: { id: string; name: string }[] };
  gaps: string[];
  nextDate: string | null;
  /// 13.11.2026: the day the next run opens, when it is before the date.
  nextOpensAt?: string | null;
  dateIds: string[];
  latestVersion: number;
  /// Built as a flow: edited in the flow editor, not here.
  isFlow?: boolean;
  current: { version: number; steps: ProcessStep[]; highlights: string | null; outputs: string | null; approvedByName: string | null; checks: PanelCheck[]; approvedAt?: string | null; atApproval?: PanelCheck[] | null } | null;
  /// `mayApprove`: whether the viewer may approve it (lib/procedure-approval.ts).
  draft: { version: number; steps: ProcessStep[]; highlights: string | null; outputs: string | null; changeNote: string | null; checks: PanelCheck[]; mayApprove?: boolean; mayDiscard?: boolean } | null;
  runs: { id: string; title: string; status: string; dueDate: string | null; stepsDone?: number; stepsTotal?: number; waitingOn?: string | null }[];
  /// 14.11.2026 (stage 3, spec 4.6): approved steps whose approver at the
  /// client has left (step 0: the process's own approver, before stage 3).
  approverLeft?: { step: number; name: string }[];
  /// 13.11.2026 (stage 2): a process that runs, or a work instruction.
  kind?: "PROCESS" | "GUIDE";
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
  /// 31.10.2026: the latest stranger test, its open questions, and the
  /// prompt that runs a new one (lib/stranger-test.ts).
  stranger?: {
    state: StrangerState | null;
    open: { id: string; step: number | null; severity: StrangerSeverityLike; askWho: StrangerAskWhoLike; question: string }[];
    prompt: string;
  };
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
  const t = useTx();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(resolveLessonAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="id" value={lesson.id} />
      <p dir="auto" className="text-sm text-app-text-primary">{lesson.body}</p>
      <Field label={t("lessons.what")}>
        <select name="status" defaultValue="APPLIED" className={INPUT}>
          <option value="APPLIED">{t("labels.lessonStatus.APPLIED")}</option>
          <option value="DISMISSED">{t("labels.lessonStatus.DISMISSED")}</option>
        </select>
      </Field>
      <Field label={t("lessons.oneLine")}>
        <input name="resolution" required placeholder={t("lessons.oneLinePlaceholder")} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

export function Lessons({ clientId, lessons, canResolve }: { clientId: string; lessons: PanelLesson[]; canResolve: boolean }) {
  const t = useTx();
  const day = useDay();
  const open = lessons.filter((l) => l.status === "OPEN");
  const done = lessons.filter((l) => l.status !== "OPEN");
  if (lessons.length === 0) return null;
  return (
    <div className="mt-2">
      {open.length > 0 && (
        <div className="rounded-lg border border-gold/40 bg-gold/[0.04] p-2.5">
          <p className="text-xs font-medium text-app-text-primary">{t("lessons.open", { count: open.length })}</p>
          <ul className="mt-1.5 space-y-1.5">
            {open.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 text-app-text-primary">
                  <span dir="auto">{l.body}</span>
                  <span className="text-app-text-tertiary">
                    {" "}
                    ({[l.authorName, day(l.createdAt), l.version ? t("lessons.version", { version: String(l.version) }) : null].filter(Boolean).join(" · ")},{" "}
                    <Link href={`/app/tasks/${l.taskId}`} className="text-app-text-accent hover:underline">
                      {t("lessons.toRun")}
                    </Link>
                    )
                  </span>
                </span>
                {canResolve && (
                  <Drawer triggerLabel={t("lessons.decide")} title={t("lessons.drawerTitle")} variant="link">
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
          <summary className="cursor-pointer">{t("lessons.handled", { count: done.length })}</summary>
          <ul className="mt-1 space-y-1">
            {done.map((l) => (
              <li key={l.id}>
                {l.body} · {t(`labels.lessonStatus.${l.status}`)}
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
export type PanelCheck = { code: string; message: string; severity: "BLOCK" | "EXCEPTION"; excepted?: boolean; step?: number; keyed?: KeyedCheck };

export function CheckLines({ checks }: { checks: PanelCheck[] }) {
  const t = useTx();
  return (
    <>
      {checks.map((c, i) => (
        <p key={i} className={`mt-1 text-xs ${c.excepted ? "text-app-text-tertiary" : "text-app-error"}`}>
          {checkText(t, c)}
          {c.severity === "EXCEPTION" && (
            <>
              {" "}
              {c.excepted ? t("checks.exceptionApproved") : t("checks.exceptionNeeded")}
            </>
          )}
        </p>
      ))}
    </>
  );
}

const TONE: Record<TransitionLike, "green" | "amber" | "gray"> = { WITH_ANKORA: "green", IN_HANDOVER: "amber", WITH_CLIENT: "gray", NOT_PLANNED: "gray" };

function Checks({ name, options, selected }: { name: string; options: Option[]; selected: string[] }) {
  const t = useTx();
  if (options.length === 0) return <p className="mt-1 text-[11px] text-app-text-tertiary">{t("common.nothingInFile")}</p>;
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
  const t = useTx();
  const [on, setOn] = useState<string[]>(selected);
  if (options.length === 0) return <p className="mt-1 text-[11px] text-app-text-tertiary">{t("common.nothingInFile")}</p>;
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
            <input name={`systemPermission:${o.id}`} defaultValue={permissions[o.id] ?? ""} placeholder={t("form.permissionPlaceholder")} aria-label={t("form.permissionAria", { name: o.name })} className={INPUT} />
          )}
        </div>
      ))}
    </div>
  );
}

/// 30.10.2026 (Ariel): one titled group of the process form. The fields
/// in `more` sit behind "הצג עוד" and stay in the form while folded, so
/// they are still sent on save. The group opens by itself only when it
/// holds a gap the process still shows. Opening it whenever a field had a
/// value would unfold every group of a mature process, which is the
/// crowding this replaced, so a filled group stays folded and says how
/// many of its fields are filled instead.
function FormGroup({ title, children, more, open = false, filled = 0 }: { title: string; children?: ReactNode; more?: ReactNode; open?: boolean; filled?: number }) {
  const t = useTx();
  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="border-b border-app-border pb-1.5 text-xs font-semibold text-app-text-primary">{title}</h3>
      {children}
      {more && (
        <details open={open} className="group">
          <summary className="cursor-pointer list-none text-xs font-medium text-app-text-accent hover:underline">
            <span className="group-open:hidden">{filled > 0 ? t("form.showMoreFilled", { filled }) : t("form.showMore")}</span>
            <span className="hidden group-open:inline">{t("form.showLess")}</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3.5">{more}</div>
        </details>
      )}
    </section>
  );
}

/// 13.11.2026 (processes redesign, stage 2): the form in parts, each edited
/// on its own from the process page. Without `only`, the whole form.
export type FormPart = "what" | "who" | "work" | "knowledge" | "document";

export function ProcessForm({
  clientId,
  existing,
  staff,
  contacts,
  systems,
  rules,
  entities,
  sourceOptions,
  only,
  withSources,
  onCreated,
}: {
  clientId: string;
  existing?: PanelProcess;
  only?: FormPart[];
  /// A new process from the "what" and "who" parts still needs its source.
  withSources?: boolean;
  /// After a new process is added: its id.
  onCreated?: (id: string) => void;
  staff: Option[];
  contacts: Option[];
  systems: Option[];
  rules: Option[];
  entities: EntityOption[];
  sourceOptions: SourceOption[];
}) {
  const t = useTx();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateProcessAction : addProcessAction, (r: { ok?: boolean; error?: string; id?: string }) => {
    // A new process opens on its own page: the window goes with the page it
    // was on. Closing it first would refresh that page, and the refresh
    // would win over the move.
    if (r.id && onCreated) return onCreated(r.id);
    close();
  });
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.knowledgeStatus ?? "CONFIRMED");
  const e = existing;
  const gap = (k: keyof typeof FIELD_LABELS) => !!e?.missing?.includes(FIELD_LABELS[k]);
  const filled = (...values: unknown[]) => values.filter((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "")).length;
  const shows = (part: FormPart) => !only || only.includes(part);
  // A part opened on its own is the thing being edited: nothing folded.
  const unfold = !!only;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="clientId" value={clientId} />
      {e && <input type="hidden" name="id" value={e.id} />}
      {only && <input type="hidden" name="_parts" value={[...only, ...(withSources ? ["sources"] : [])].join(",")} />}
      {shows("what") && (
      <FormGroup title={t("form.groupWhat")}>
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Field label={t("form.name")}>
            <input name="title" required defaultValue={e?.title ?? ""} placeholder={t("form.namePlaceholder")} className={INPUT} />
          </Field>
          <Field label={t("form.purpose")}>
            <input name="purpose" defaultValue={e?.purpose ?? ""} className={INPUT} />
          </Field>
        </div>
        {/* 13.11.2026 (stage 1): what starts it is the rhythm, edited from the
            card ("מתי התהליך רץ?"). */}
      </FormGroup>
      )}

      {shows("who") && (
      <FormGroup
        title={t("form.groupWho")}
        open={gap("approvals")}
        filled={filled(e?.backupOwnerId, e?.executorText)}
        more={
          <>
            <div className="grid gap-3.5 lg:grid-cols-2">
              <Field label={t("form.backup")}>
                <select name="backupOwnerId" defaultValue={e?.backupOwnerId ?? ""} className={INPUT}>
                  <option value="">{t("common.none")}</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("form.executorText")}>
                <input name="executorText" defaultValue={e?.executorText ?? ""} placeholder={t("form.executorTextPlaceholder")} className={INPUT} />
              </Field>
            </div>
            {/* 14.11.2026 (processes redesign, stage 5): the approver is each
                step's, set in the steps editor. The process's own stays in the
                data, read as the fallback for a step that names none. */}
          </>
        }
      >
        <div className="grid gap-3.5 lg:grid-cols-3">
          <Field label={t("form.owner")}>
            <select name="ownerId" defaultValue={e?.ownerId ?? ""} className={INPUT}>
              <option value="">{t("form.notSet")}</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.executorAnkora")}>
            <select name="executorUserId" defaultValue={e?.executorUserId ?? ""} aria-label={t("form.executorAnkoraAria")} className={INPUT}>
              <option value="">{t("form.noneAtAnkora")}</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.executorClient")}>
            <select name="executorContactId" defaultValue={e?.executorContactId ?? ""} aria-label={t("form.executorClientAria")} className={INPUT}>
              <option value="">{t("form.noneAtClient")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </FormGroup>

      )}

      {shows("work") && (
      <>
      <FormGroup
        title={t("form.groupTiming")}
        filled={filled(e?.reviewEveryDays)}
        more={
          only ? undefined : (
            <>
              {/* 13.11.2026 (stage 1): the business calendar is the rhythm's,
                  set in the rhythm editor next to the dates it moves. */}
              <div className="grid gap-3.5 lg:grid-cols-2">
                <Field label={t("form.reviewEvery")}>
                  <input name="reviewEveryDays" inputMode="numeric" defaultValue={e?.reviewEveryDays ?? ""} placeholder="90" className={INPUT} />
                </Field>
              </div>
            </>
          )
        }
      >
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label={t("form.sla")}>
            <input name="slaText" defaultValue={e?.slaText ?? ""} placeholder={t("form.slaPlaceholder")} className={INPUT} />
          </Field>
          <Field label={t("form.businessDays")}>
            <input name="slaBusinessDays" inputMode="numeric" defaultValue={e?.slaBusinessDays ?? ""} className={INPUT} />
          </Field>
        </div>
      </FormGroup>

      <FormGroup
        title={t("form.groupSystems")}
        open={unfold || gap("external") || gap("approvals")}
        filled={filled(e?.externalPartyContactIds, e?.externalPartyText, e?.approvalPolicyIds, e?.approvalText)}
        more={
          <>
            <div>
              <span className={LABEL}>{t("form.external")}</span>
              <Checks name="externalPartyContactIds" options={contacts} selected={e?.externalPartyContactIds ?? []} />
              <input name="externalPartyText" defaultValue={e?.externalPartyText ?? ""} placeholder={t("form.externalPlaceholder")} className={INPUT} />
            </div>
            <div>
              <span className={LABEL}>{t("form.thresholds")}</span>
              <Checks name="approvalPolicyIds" options={rules} selected={e?.approvalPolicyIds ?? []} />
              <input name="approvalText" defaultValue={e?.approvalText ?? ""} placeholder={t("form.thresholdsPlaceholder")} className={INPUT} />
            </div>
          </>
        }
      >
        <div>
          <span className={LABEL}>{t("form.systems")}</span>
          <SystemChecks options={systems} selected={e?.requiredSystemIds ?? []} permissions={e?.requiredSystemPermissions ?? {}} />
        </div>
      </FormGroup>
      </>
      )}
      {only?.includes("work") && (
        <Field label={t("form.exceptionPlaybook")}>
          <textarea name="exceptionPlaybook" rows={3} defaultValue={e?.exceptionPlaybook ?? ""} placeholder={t("form.exceptionPlaceholder")} className={INPUT} />
        </Field>
      )}

      {withSources && <SourcesField options={sourceOptions} defaultValue={e?.sources.join(", ")} status={status} confirmedBefore={e?.knowledgeStatus === "CONFIRMED"} />}

      {shows("knowledge") && (
      <FormGroup title={t("form.groupState")}>
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Field label={t("form.handover")}>
            <select name="transitionStatus" defaultValue={e?.transitionStatus ?? "WITH_CLIENT"} className={INPUT}>
              {(Object.keys(TRANSITION_LABELS) as TransitionLike[]).map((k) => (
                <option key={k} value={k}>
                  {t(`labels.transitions.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("form.knowledge")}>
            <select name="knowledgeStatus" value={status} onChange={(ev) => setStatus(ev.target.value as KnowledgeStatusLike)} className={INPUT}>
              <option value="CONFIRMED">{t("labels.knowledgeStatus.CONFIRMED")}</option>
              <option value="UNCERTAIN">{t("labels.knowledgeStatus.UNCERTAIN")}</option>
              <option value="MISSING">{t("labels.knowledgeStatus.MISSING")}</option>
            </select>
          </Field>
        </div>
        {status !== "CONFIRMED" && (
          <Field label={t("form.toResolve")}>
            <input name="toResolve" required defaultValue={e?.toResolve ?? ""} className={INPUT} />
          </Field>
        )}
        <EntitySelect entities={entities} defaultValue={e?.entityId} />
        <SourcesField options={sourceOptions} defaultValue={e?.sources.join(", ")} status={status} confirmedBefore={e?.knowledgeStatus === "CONFIRMED"} />
        <ItemExtras existing={e} owner={false} disclose audience />
      </FormGroup>
      )}

      {only?.includes("document") && (
        <Field label={t("form.reviewEvery")}>
          <input name="reviewEveryDays" inputMode="numeric" defaultValue={e?.reviewEveryDays ?? ""} placeholder="90" className={INPUT} />
        </Field>
      )}
      {(!only || only.includes("document")) && (
      <FormGroup
        title={only ? t("form.groupDocument") : t("form.groupExceptions")}
        open={unfold || gap("exceptions")}
        filled={filled(e?.exceptionPlaybook, e?.scope, e?.definitions, e?.controlRefs, e?.relatedDocs)}
        more={
          <>
            {!only && (
              <Field label={t("form.exceptionPlaybook")}>
                <textarea name="exceptionPlaybook" rows={3} defaultValue={e?.exceptionPlaybook ?? ""} placeholder={t("form.exceptionPlaceholder")} className={INPUT} />
              </Field>
            )}
            <p className="text-[11px] text-app-text-tertiary">{t("form.docHelp")}</p>
            <div className="grid gap-3.5 lg:grid-cols-2">
              <Field label={t("form.scope")}>
                <textarea name="scope" rows={2} defaultValue={e?.scope ?? ""} placeholder={t("form.scopePlaceholder")} className={INPUT} />
              </Field>
              <Field label={t("form.definitions")}>
                <textarea name="definitions" rows={2} defaultValue={e?.definitions ?? ""} placeholder={t("form.definitionsPlaceholder")} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_9rem] gap-3">
              <Field label={t("form.controls")}>
                <input name="controlRefs" dir="ltr" defaultValue={e?.controlRefs?.join(", ") ?? ""} placeholder="CC6.2, CC6.3" className={INPUT} />
              </Field>
              <Field label={t("form.classification")}>
                <select name="classification" defaultValue={e?.classification ?? "CONFIDENTIAL"} className={INPUT}>
                  <option value="CONFIDENTIAL">{t("labels.classifications.CONFIDENTIAL")}</option>
                  <option value="INTERNAL">{t("labels.classifications.INTERNAL")}</option>
                  <option value="PUBLIC">{t("labels.classifications.PUBLIC")}</option>
                </select>
              </Field>
            </div>
            <Field label={t("form.relatedDocs")}>
              <textarea name="relatedDocs" rows={2} defaultValue={e?.relatedDocs ?? ""} placeholder={t("form.relatedDocsPlaceholder")} className={INPUT} />
            </Field>
          </>
        }
      />
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("common.saving") : existing ? t("common.save") : t("form.addToFile")}
      </button>
    </form>
  );
}

const EMPTY_STEP: ProcessStep = { title: "", mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null };

export function ProcedureEditor({ clientId, process, systems }: { clientId: string; process: PanelProcess; systems: Option[] }) {
  const t = useTx();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveProcessVersionAction, close);
  const start = process.draft ?? process.current;
  const [steps, setSteps] = useState<ProcessStep[]>(start?.steps.length ? start.steps : [{ ...EMPTY_STEP }]);
  const set = (i: number, patch: Partial<ProcessStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // 28.10.2026 (Ariel, P4 of NUX: "I have no idea what to fix and
  // where"): the checks that hold the approval, as the steps stand now,
  // at the top and on the step they are about. The steps' own checks run
  // here as you type; the client's rules are the saved version's, as the
  // server read them.
  const live = blockingChecks({ steps }, []);
  const ruled = (start?.checks ?? []).filter((c) => !c.excepted && !["R1", "R3", "R4"].includes(c.code));
  const issues = [...live, ...ruled];
  const atStep = (n: number) => issues.filter((c) => c.step === n);
  const first = useRef<HTMLLIElement>(null);
  const firstStep = issues.find((c) => c.step)?.step;
  useEffect(() => {
    first.current?.scrollIntoView({ block: "center" });
    // Only on opening: a step that fails while typing is not jumped to.
  }, []);
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
      <p className="text-xs text-app-text-secondary">{t("editor.savedAs", { version: String(process.latestVersion + 1) })}</p>
      {issues.length > 0 && (
        <div className="rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2.5" data-testid="procedure-issues">
          <p className="text-xs font-medium text-app-error">{t("editor.blocking", { count: issues.length })}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {issues.map((c, i) => (
              <li key={i} className="text-xs text-app-error">
                {checkText(t, c)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="flex flex-col gap-3">
        {steps.map((st, i) => (
          <li key={i} ref={i + 1 === firstStep ? first : undefined} className={`rounded-lg border p-3 ${atStep(i + 1).length ? "border-app-error" : "border-app-border"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-app-text-secondary">{t("editor.step", { n: i + 1 })}</span>
              <span className="flex gap-2 text-xs text-app-text-tertiary">
                <button type="button" onClick={() => move(i, -1)} aria-label={t("editor.moveUp", { n: i + 1 })}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} aria-label={t("editor.moveDown", { n: i + 1 })}>
                  ↓
                </button>
                <button type="button" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} className="hover:text-app-error">
                  {t("editor.removeStep")}
                </button>
              </span>
            </div>
            {atStep(i + 1).map((c, k) => (
              <p key={k} className="mb-1.5 text-xs text-app-error">
                {checkText(t, c)}
              </p>
            ))}
            <input aria-label={t("editor.whatAria", { n: i + 1 })} dir="auto" value={st.title} onChange={(e) => set(i, { title: e.target.value })} placeholder={t("editor.whatPlaceholder")} className={INPUT} />
            <div className="mt-2 grid grid-cols-[1fr_7rem] gap-2">
              <select aria-label={t("editor.howAria", { n: i + 1 })} value={st.mode} onChange={(e) => set(i, { mode: e.target.value as StepModeLike })} className={INPUT}>
                {(Object.keys(STEP_MODE_LABELS) as StepModeLike[]).map((m) => (
                  <option key={m} value={m}>
                    {t(`labels.stepModes.${m}`)}
                  </option>
                ))}
              </select>
              <input
                aria-label={t("editor.daysAria", { n: i + 1 })}
                inputMode="numeric"
                value={st.offsetBusinessDays ?? ""}
                onChange={(e) => set(i, { offsetBusinessDays: /^-?\d+$/.test(e.target.value) ? Number(e.target.value) : null })}
                placeholder={t("editor.daysPlaceholder")}
                className={INPUT}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {ACTION_TAGS.map((tag) => (
                <label key={tag} className="flex items-center gap-1 text-xs text-app-text-secondary">
                  <input
                    type="checkbox"
                    checked={st.actionTags.includes(tag)}
                    onChange={(e) => set(i, { actionTags: e.target.checked ? [...st.actionTags, tag] : st.actionTags.filter((x: ActionTag) => x !== tag) })}
                    className="h-3.5 w-3.5 accent-gold"
                  />
                  {t(`labels.actionTags.${tag}`)}
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
            <input value={st.output ?? ""} onChange={(e) => set(i, { output: e.target.value || null })} placeholder={t("editor.outputPlaceholder")} className={INPUT} />
            {st.actionTags.some((tag) => MONEY_TAGS.includes(tag)) && (
              <div className="mt-2 grid grid-cols-[1fr_6rem] gap-2">
                <input
                  aria-label={t("editor.amountAria", { n: i + 1 })}
                  inputMode="decimal"
                  value={st.amountMaxMinor === null ? "" : String(st.amountMaxMinor / 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/,/g, ""));
                    set(i, { amountMaxMinor: e.target.value.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null });
                  }}
                  placeholder={t("editor.amountPlaceholder")}
                  className={INPUT}
                />
                <select aria-label={t("editor.currencyAria", { n: i + 1 })} value={st.currency ?? ""} onChange={(e) => set(i, { currency: e.target.value || null })} className={INPUT}>
                  <option value="">{t("editor.currency")}</option>
                  {["ILS", "USD", "EUR"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {st.actionTags.includes("CLIENT_MESSAGE") && (
              <select aria-label={t("editor.channelAria", { n: i + 1 })} value={st.channel ?? ""} onChange={(e) => set(i, { channel: (e.target.value || null) as Channel | null })} className={`mt-2 ${INPUT}`}>
                <option value="">{t("editor.channelPlaceholder")}</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t(`labels.channels.${c}`)}
                  </option>
                ))}
              </select>
            )}
            {st.mode === "AUTOMATED" && (
              <input
                aria-label={t("editor.verificationAria", { n: i + 1 })}
                aria-invalid={!st.verification}
                value={st.verification ?? ""}
                onChange={(e) => set(i, { verification: e.target.value || null })}
                placeholder={t("editor.verificationPlaceholder")}
                className={`${INPUT} ${st.verification ? "" : "!border-app-error"}`}
              />
            )}
            <label className="mt-2 flex items-center gap-1.5 text-xs text-app-text-primary">
              <input type="checkbox" checked={st.requiresApproval} onChange={(e) => set(i, { requiresApproval: e.target.checked })} className="h-4 w-4 accent-gold" />
              {t("editor.requiresApproval")}
            </label>
          </li>
        ))}
      </ol>
      {steps.length < MAX_PROCESS_STEPS && (
        <button type="button" onClick={() => setSteps((all) => [...all, { ...EMPTY_STEP }])} className="self-start text-xs text-app-text-accent hover:underline">
          {t("editor.addStep")}
        </button>
      )}
      <Field label={t("editor.highlights")}>
        <textarea name="highlights" rows={2} defaultValue={start?.highlights ?? ""} placeholder={t("editor.highlightsPlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("editor.outputs")}>
        <input name="outputs" defaultValue={start?.outputs ?? ""} className={INPUT} />
      </Field>
      <Field label={t("editor.changeNote")}>
        <input name="changeNote" className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("common.saving") : t("editor.saveDraft")}
      </button>
    </form>
  );
}

export function StartRunForm({ clientId, process }: { clientId: string; process: PanelProcess }) {
  const t = useTx();
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(startProcessRunAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={process.id} />
      <p className="text-xs text-app-text-secondary">{t("run.opens", { count: process.current?.steps.length ?? 0, version: String(process.current?.version ?? "") })}</p>
      <p className="text-xs text-app-text-secondary">{t("run.oneRun")}</p>
      <Field label={t("run.day")}>
        <input name="day" type="date" required className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("run.opening") : t("run.open")}
      </button>
    </form>
  );
}

function StepList({ steps, systemName }: { steps: ProcessStep[]; systemName: Map<string, string> }) {
  const t = useTx();
  return (
    <ol className="mt-1.5 space-y-1.5">
      {steps.map((st, i) => (
        <li key={i} className="text-xs text-app-text-primary">
          <span className="font-medium">
            {i + 1}. {st.title}
          </span>
          <span className="text-app-text-tertiary">
            {" · "}
            {t(`labels.stepModes.${st.mode}`)}
            {st.offsetBusinessDays !== null && ` · ${t("steps.days", { days: st.offsetBusinessDays >= 0 ? `+${st.offsetBusinessDays}` : String(st.offsetBusinessDays) })}`}
            {st.actionTags.length > 0 && ` · ${st.actionTags.map((tag) => t(`labels.actionTags.${tag}`)).join(", ")}`}
            {st.systemIds.length > 0 && ` · ${st.systemIds.map((id) => systemName.get(id) ?? t("steps.removedSystem")).join(", ")}`}
            {st.amountMaxMinor !== null && st.currency && ` · ${t("steps.upTo", { amount: formatAmount(st.amountMaxMinor, st.currency) })}`}
            {st.channel && ` · ${t("steps.via", { channel: t(`labels.channels.${st.channel}`) })}`}
            {st.requiresApproval && ` · ${t("steps.needsApproval")}`}
          </span>
          {st.verification && <span className="block text-app-text-tertiary">{t("steps.verification", { text: st.verification })}</span>}
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
  const t = useTx();
  const { showToast } = useToast();
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const withUs = processes.filter((p) => p.transitionStatus === "WITH_ANKORA").length;
  const handover = processes.filter((p) => p.transitionStatus === "IN_HANDOVER").length;
  const running = processes.filter((p) => p.readiness?.ready).length;
  const docAvg = processes.length ? Math.round((processes.reduce((a, p) => a + (p.doc && p.doc.of ? p.doc.score / p.doc.of : 1), 0) / processes.length) * 100) : 0;

  async function act(fn: () => Promise<{ error?: string }>, ok: string) {
    const r = await fn();
    if (r.error) showToast({ tone: "error", title: t("panel.actionFailed"), description: r.error });
    else showToast({ tone: "success", title: ok });
  }

  const form = { staff, contacts, systems, rules, entities, sourceOptions };
  return (
    <div id="processes" className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">{t("panel.title", { count: processes.length })}</h2>
        <div className="flex items-center gap-4">
          {processes.some((p) => p.current) && (
            <Link href={`/app/clients/${clientId}/procedures`} className="text-xs font-medium text-app-text-accent hover:underline" data-testid="procedures-index-link">
              {t("panel.proceduresLink")}
            </Link>
          )}
          <Link href={`/app/clients/${clientId}/connections`} className="text-xs font-medium text-app-text-accent hover:underline" data-testid="connections-link">
            {t("panel.connectionsLink")}
          </Link>
          <Drawer triggerLabel={t("panel.add")} title={t("panel.drawerTitle")} variant="link">
            <ProcessForm clientId={clientId} {...form} />
          </Drawer>
        </div>
      </div>
      {processes.length > 0 && (
        <p className="mt-1 text-[11px] text-app-text-tertiary">
          {running === processes.length ? t("panel.allRunning") : t("panel.someRunning", { running, total: processes.length })} · {t("panel.summaryRest", { withUs, handover, doc: docAvg })}
        </p>
      )}
      {processes.length === 0 ? (
        <p className="mt-2 text-sm text-app-text-tertiary">{t("panel.empty")}</p>
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

export type FormOptions = { staff: Option[]; contacts: Option[]; systems: Option[]; rules: Option[]; entities: EntityOption[]; sourceOptions: SourceOption[] };

/// The facts next steps read, from what the card already has.
function factsOf(p: PanelProcess, canMark = false): ProcessFacts {
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
    review: p.reviewReason ? { label: REVIEW_REASON_LABELS[p.reviewReason], periodic: p.reviewReason === "PERIODIC", reason: p.reviewReason } : null,
    openLessons: p.lessons.filter((l) => l.status === "OPEN").length,
    knowledge: { uncertain: p.knowledgeStatus === "UNCERTAIN" || p.knowledgeStatus === "MISSING", toResolve: p.toResolve },
    dateCandidate: p.dateCandidate ?? null,
    readiness: p.readiness,
    doc: p.docMissing,
    suggestions: p.suggestions,
    canMarkNotApplicable: canMark,
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
  const t = useTx();
  const tPanel = useTranslations("clients.processes.panel");
  const day = useDay();
  const rhythmLang = useLocale().startsWith("en") ? "en" : "he";
  const [open, setOpen] = useState(!!p.draft);
  const [view, setView] = useProcessView();
  useEffect(() => {
    // Arriving on this process by its link opens it.
    const check = () => {
      if (window.location.hash === `#item-${p.id}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [p.id]);
  const canMark = canApprove || (!!userId && p.ownerId === userId);
  const steps = nextSteps(factsOf(p, canMark), canApprove, p.draft?.mayApprove ?? canApprove);
  // 25.10.2026: documentation is never "the next step"; it is listed last,
  // quietly, under what actually needs doing.
  const [first, ...others] = steps.filter((st) => st.kind !== "doc_field");
  const rest = [...others, ...steps.filter((st) => st.kind === "doc_field")];

  const fixButton = (step: NextStep, primary: boolean) => {
    const cls = primary ? "rounded-full bg-app-surface-nav px-3 py-1 text-[12px] font-medium text-cream" : "text-[12px] font-medium text-app-text-accent hover:underline";
    const f = step.fix;
    const label = stepText(t, step.text?.fix, f.label);
    if (f.kind === "op") {
      return (
        <button type="button" onClick={() => act(() => runProcessStepAction(f.op, clientId), t("panel.done"))} className={cls} data-testid="step-op">
          {label}
        </button>
      );
    }
    if (f.kind === "edit") {
      return (
        <Drawer triggerLabel={label} title={t("panel.editTitle", { code: p.code, title: p.title })} variant="link">
          <ProcessForm clientId={clientId} existing={p} {...form} />
        </Drawer>
      );
    }
    if (f.kind === "procedure") {
      return (
        <Drawer triggerLabel={label} title={t("panel.procedureTitle", { code: p.code, title: p.title })} variant="link">
          <ProcedureEditor clientId={clientId} process={p} systems={systems} />
        </Drawer>
      );
    }
    if (f.kind === "dates") {
      return (
        <CenterDialog triggerLabel={label} eyebrow={`${p.code} ${p.title}`} title={t("rhythm.title")}>
          <RhythmEditor clientId={clientId} processId={p.id} starts={p.rhythmStarts ?? []} dates={p.rhythmDates ?? []} />
        </CenterDialog>
      );
    }
    return (
      <button type="button" onClick={() => setOpen(true)} className={cls}>
        {label}
      </button>
    );
  };

  return (
    <li id={`item-${p.id}`} className="py-4 scroll-mt-24 rounded-lg target:bg-app-accent-soft" data-testid="process-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-app-text-tertiary">{p.code}</span>
            <p dir="auto" className="text-sm font-medium text-app-text-primary">
              {p.title}
            </p>
            <StatusBadge label={t(`labels.transitions.${p.transitionStatus}`)} tone={TONE[p.transitionStatus]} />
            {p.readiness &&
              (p.readiness.ready ? (
                <span className="text-xs font-medium text-app-success" data-testid="process-readiness" data-ready="true">
                  {t("readiness.runs")}
                </span>
              ) : (
                <span className="text-xs font-medium text-app-error" data-testid="process-readiness" data-ready="false">
                  {(() => {
                    const key = runBlockerKey(p.readiness.blocker);
                    return key ? t(`readiness.blockers.${key}`) : p.readiness.blocker;
                  })()}
                </span>
              ))}
            {p.doc && (
              <span className="text-[11px] text-app-text-tertiary" data-testid="process-documentation">
                {p.doc.score >= p.doc.of ? t("documentation.full") : t("documentation.partial", { score: p.doc.score, of: p.doc.of })}
              </span>
            )}
            {p.stranger && (
              <span
                className={`text-[11px] ${p.stranger.state && p.stranger.state.blockers > 0 ? "text-app-error" : p.stranger.state && p.stranger.state.open === 0 ? "text-app-success" : "text-app-text-tertiary"}`}
                data-testid="process-stranger"
              >
                <StrangerLine state={p.stranger.state} />
              </span>
            )}
            {p.reviewReason && <StatusBadge label={t("panel.needsReview")} tone="red" />}
            {p.current && (
              <span className="ms-auto">
                <ViewSwitch view={view} onChange={setView} />
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-app-text-secondary">
            {[
              p.ownerId ? t("panel.owner", { name: staffName.get(p.ownerId) ?? "" }) : null,
              p.backupOwnerId ? t("panel.backup", { name: staffName.get(p.backupOwnerId) ?? "" }) : null,
              p.nextDate ? t("panel.next", { date: day(p.nextDate) }) : null,
              p.lastRunAt ? t("panel.lastRun", { date: day(p.lastRunAt) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-app-text-primary" data-testid="process-rhythm">
            <span>{p.rhythmStarts?.length ? describeRhythm(p.rhythmStarts, p.rhythmDates ?? [], rhythmLang) : <span className="text-app-text-secondary">{t("rhythm.notSet")}</span>}</span>
            <CenterDialog triggerLabel={p.rhythmStarts?.length ? t("rhythm.change") : t("rhythm.set")} eyebrow={`${p.code} ${p.title}`} title={t("rhythm.title")}>
              <RhythmEditor clientId={clientId} processId={p.id} starts={p.rhythmStarts ?? []} dates={p.rhythmDates ?? []} />
            </CenterDialog>
          </p>
          {p.nextDate && p.nextOpensAt && day(p.nextOpensAt) !== day(p.nextDate) && (
            <p className="text-xs text-app-text-tertiary" data-testid="process-next-opens">
              {t("panel.nextOpens", { date: day(p.nextOpensAt) })}
            </p>
          )}

          {p.stranger && <StrangerBlock stranger={p.stranger} />}

          {first ? (
            <div className={`mt-2 rounded-lg px-3 py-2 ${first.blocking ? "bg-app-error-soft" : "bg-app-warning-soft"}`} data-testid="process-next-step" data-step={first.kind}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-xs text-app-text-primary">
                  <span className="font-medium">
                    {t("panel.nextStepLabel")}{" "}
                  </span>
                  {stepText(t, first.text?.title, first.title)}
                  {first.recommend && (
                    <span className="text-[11.5px] text-app-text-secondary">
                      {" · "}
                      {t("panel.recommendedLine", { recommend: stepText(t, first.text?.recommend ?? undefined, first.recommend) })}
                      {first.why && ` ${stepText(t, first.text?.why ?? undefined, first.why)}`}
                    </span>
                  )}
                </p>
                {fixButton(first, true)}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs font-medium text-app-success" data-testid="process-next-step" data-step="none">
              {t("panel.allClear")}
            </p>
          )}

          {rest.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="process-checklist">
              {rest.map((st) => (
                <li key={st.key ? `${st.kind}:${st.key}` : st.kind} className="flex flex-wrap items-start justify-between gap-2 text-xs" data-step={st.kind}>
                  <span className={`min-w-0 flex-1 ${st.kind === "doc_field" ? "text-app-text-tertiary" : "text-app-text-primary"}`}>
                    <span aria-hidden className="me-1.5 inline-block h-3 w-3 rounded-sm border border-app-border-strong align-middle" />
                    {stepText(t, st.text?.title, st.title)}
                    {st.recommend && (
                      <span className="text-app-text-tertiary">
                        {" · "}
                        {t("panel.recommendedShort", { recommend: stepText(t, st.text?.recommend ?? undefined, st.recommend) })}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    {fixButton(st, false)}
                    {st.alt?.kind === "op" && (
                      <button
                        type="button"
                        onClick={() => act(() => runProcessStepAction((st.alt as { kind: "op"; op: StepOp }).op, clientId), t("panel.markedNotApplicable"))}
                        className="text-[12px] text-app-text-tertiary hover:text-app-text-primary hover:underline"
                        data-testid="mark-not-applicable"
                      >
                        {stepText(t, st.text?.alt, st.alt.label)}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(p.notApplicable ?? []).length > 0 && (
            <p className="mt-1.5 text-[11px] text-app-text-tertiary" data-testid="process-not-applicable">
              {t("panel.notApplicable")}{" "}
              {p.notApplicable!.map((f, i) => (
                <span key={f.field}>
                  {i > 0 && ", "}
                  {f.field in FIELD_LABELS ? t(`labels.fields.${f.field}`) : f.label}
                  {canMark && (
                    <button type="button" onClick={() => act(() => restoreProcessFieldAction(p.id, f.field, clientId), t("panel.markRemoved"))} className="ms-1 hover:text-app-text-primary hover:underline">
                      {t("panel.undoMark")}
                    </button>
                  )}
                </span>
              ))}
            </p>
          )}

          {p.current && view === "visual" && (
            <ProcessVisual
              triggerKinds={p.triggerKinds}
              triggerText={p.triggerText}
              slaBusinessDays={p.slaBusinessDays}
              nextDate={p.nextDate}
              steps={p.current.steps}
            />
          )}

          <details className="mt-2" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="process-details">
            <summary className="cursor-pointer text-xs font-medium text-app-text-secondary hover:text-app-text-primary">{t("panel.details")}</summary>
            <div className="mt-1.5">
              <p className="text-xs text-app-text-secondary">
                {[
                  p.triggerText,
                  p.executorName || p.executorText ? t("panel.executorToday", { name: p.executorName ?? p.executorText ?? "" }) : null,
                  p.systemsLine ? t("panel.systems", { list: p.systemsLine }) : null,
                  p.reviewReason ? `${t(`labels.reviewReasons.${p.reviewReason}`)}${p.reviewReason === "PERIODIC" && p.reviewEveryDays ? ` ${t("panel.reviewEvery", { days: String(p.reviewEveryDays) })}` : ""}` : null,
                  !p.reviewReason && p.reviewDueAt ? t("panel.nextReview", { date: day(p.reviewDueAt) }) : null,
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
        <div className="flex shrink-0 flex-col items-end gap-2 text-xs" data-testid="process-actions">
          {p.status === "ACTIVE" && p.triggerKinds.some((t) => t !== "CONTINUOUS" && t !== "EXTERNAL") && (
            <Drawer
              triggerLabel={t("panel.startRun")}
              title={t("panel.runTitle", { code: p.code, title: p.title })}
              variant="link"
              triggerClassName="rounded-full bg-app-accent px-3 py-1.5 font-medium !text-app-text-primary"
            >
              <StartRunForm clientId={clientId} process={p} />
            </Drawer>
          )}
          {p.routine && (
            <Drawer triggerLabel={t("panel.recordCheck")} title={t("panel.checkTitle", { code: p.code, title: p.title })} variant="link">
              <ProcessCheckForm clientId={clientId} processId={p.id} checkText={p.checkText} steps={p.current?.steps.map((st) => st.title) ?? []} />
            </Drawer>
          )}
          <Drawer triggerLabel={t("panel.edit")} title={t("panel.editTitle", { code: p.code, title: p.title })} variant="link">
            <ProcessForm clientId={clientId} existing={p} {...form} />
          </Drawer>
          <Drawer triggerLabel={p.draft ? t("panel.editDraft") : p.current ? t("panel.newVersion") : t("panel.writeProcedure")} title={t("panel.procedureTitle", { code: p.code, title: p.title })} variant="link">
            {p.isFlow ? (
              <p className="text-sm text-app-text-secondary" data-testid="procedure-is-flow">
                {tPanel.rich("isFlow", {
                  link: (chunks) => (
                    <Link href={`/app/clients/${clientId}/processes/${p.id}/flow`} className="font-medium text-app-text-accent hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            ) : (
              <ProcedureEditor clientId={clientId} process={p} systems={systems} />
            )}
          </Drawer>
          <Link href={`/app/clients/${clientId}/processes/${p.id}/flow`} className="font-medium text-app-text-accent hover:underline" data-testid="procedure-flow-link">
            {t("panel.flowEditor")}
          </Link>
          {p.latestVersion > 0 && (
            <Link href={`/app/clients/${clientId}/processes/${p.id}/document`} className="font-medium text-app-text-accent hover:underline" data-testid="procedure-document-link">
              {t("panel.document")}
            </Link>
          )}
          {((canApprove && (p.status === "ACTIVE" || p.status === "PAUSED")) || p.status === "DRAFT" || !!p.draft?.mayDiscard) && (
            <details className="relative" data-testid="process-more">
              <summary className="cursor-pointer list-none text-app-text-tertiary hover:text-app-text-primary">{t("panel.more")}</summary>
              <div className="absolute end-0 z-10 mt-1 flex min-w-[7rem] flex-col items-start gap-2 rounded-lg border border-app-border bg-app-surface-card p-2.5 shadow-md">
                {canApprove && p.status === "ACTIVE" && (
                  <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "PAUSED", clientId), t("panel.paused"))} className="text-app-text-secondary hover:text-app-text-primary">
                    {t("panel.pause")}
                  </button>
                )}
                {canApprove && p.status === "PAUSED" && (
                  <button type="button" onClick={() => act(() => setProcessStatusAction(p.id, "ACTIVE", clientId), t("panel.resumed"))} className="text-app-text-secondary hover:text-app-text-primary">
                    {t("panel.resume")}
                  </button>
                )}
                {p.draft?.mayDiscard && (
                  <button
                    type="button"
                    onClick={() => {
                      const draft = p.draft!;
                      const ask = p.current ? t("panel.discardDraftConfirmRuns", { version: draft.version, current: p.current.version }) : t("panel.discardDraftConfirm", { version: draft.version });
                      if (window.confirm(ask)) act(() => discardProcessVersionAction(p.id, draft.version, clientId), t("panel.draftDiscarded"));
                    }}
                    className="text-app-text-secondary hover:text-app-error"
                    data-testid="process-discard-draft"
                  >
                    {t("panel.discardDraft")}
                  </button>
                )}
                {canApprove && (p.status === "ACTIVE" || p.status === "PAUSED") && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t("panel.retireConfirm", { code: p.code, title: p.title }))) act(() => setProcessStatusAction(p.id, "RETIRED", clientId), t("panel.retired"));
                    }}
                    className="text-app-text-secondary hover:text-app-error"
                    data-testid="process-retire"
                  >
                    {t("panel.retire")}
                  </button>
                )}
                {p.status === "DRAFT" && (
                  <button type="button" onClick={() => act(() => removeProcessAction(p.id, clientId), t("panel.removed"))} className="text-app-text-secondary hover:text-app-error">
                    {t("panel.remove")}
                  </button>
                )}
              </div>
            </details>
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
  const t = useTx();
  const day = useDay();
  return (
    <>
      {p.current ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-app-text-secondary">
            {t("panel.versionLine", { version: String(p.current.version) })}
            {p.current.approvedByName && t("panel.approvedBy", { name: p.current.approvedByName })}
            {p.current.approvedAt && ` ${t("panel.approvedOn", { date: day(p.current.approvedAt) })}`}
          </p>
          {p.current.atApproval && (
            <div className="mt-0.5" data-testid="approval-checks">
              <p className="text-[11px] text-app-text-tertiary">
                {p.current.atApproval.length === 0 ? t("panel.atApprovalClean") : t("panel.atApprovalExceptions", { count: p.current.atApproval.length })}
              </p>
              {p.current.atApproval.length > 0 && <CheckLines checks={p.current.atApproval} />}
            </div>
          )}
          <StepList steps={p.current.steps} systemName={systemName} />
          {p.current.highlights && <p className="mt-1 text-xs text-app-text-secondary">{t("panel.highlights", { text: p.current.highlights })}</p>}
          {p.current.checks.some((c) => !c.excepted) && (
            <div className="mt-1.5 rounded-lg border border-app-error/30 bg-app-error-soft px-3 py-2">
              <p className="text-xs font-medium text-app-error">{t("panel.currentFails")}</p>
              <CheckLines checks={p.current.checks.filter((c) => !c.excepted)} />
            </div>
          )}
        </div>
      ) : (
        !p.draft && <p className="mt-2 text-xs text-app-text-tertiary">{t("panel.noProcedure")}</p>
      )}

      {p.runs.length > 0 && (
        <p className="mt-1.5 text-xs text-app-text-secondary">
          {t("panel.runs")}{" "}
          {p.runs.map((r, i) => (
            <span key={r.id}>
              {i > 0 && " · "}
              <Link href={`/app/tasks/${r.id}`} className="text-app-text-accent hover:underline">
                {r.dueDate ? day(r.dueDate) : r.title}
              </Link>
              {r.status === "DONE" && ` ${t("panel.runDone")}`}
            </span>
          ))}
        </p>
      )}

      <Lessons clientId={clientId} lessons={p.lessons} canResolve={canApprove || (!!userId && p.ownerId === userId)} />

      {p.checkEvery && (
        <p className="mt-1.5 text-xs text-app-text-secondary">
          {t("panel.checkLine", { every: p.checkEveryDays ? t("panel.checkEvery", { days: String(p.checkEveryDays) }) : p.checkEvery })}
          {p.checkText && `: ${p.checkText}`}
          {p.checkDue && (
            <span className={p.checkDue.state === "LATER" ? "text-app-text-tertiary" : "text-app-warning"}>
              {" · "}
              {p.checkDue.state === "LATER"
                ? t("panel.checkNext", { date: day(p.checkDue.key) })
                : p.checkDue.state === "OVERDUE"
                  ? t("panel.checkOverdue", { date: day(p.checkDue.key) })
                  : t(`labels.checkStates.${p.checkDue.state}`)}
            </span>
          )}
        </p>
      )}
      {p.checks.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {p.checks.map((c) => (
            <li key={c.id} className={`text-xs ${c.outcome === "ISSUE" ? "text-app-warning" : "text-app-text-secondary"}`}>
              {day(c.createdAt)}
              {c.checkedByName && `, ${c.checkedByName}`}: {t(`labels.checkOutcomes.${c.outcome}`)}
              {c.note && `. ${c.note}`}
              {c.taskId && (
                <>
                  {" · "}
                  <Link href={`/app/tasks/${c.taskId}`} className="text-app-text-accent hover:underline">
                    {t("panel.taskLink")}
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
            {t("panel.draftLine", { version: String(p.draft.version) })}
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

/// 31.10.2026: the stranger test on the card. The open questions, the
/// blocking ones first, and the prompt that runs a new test in Claude. The
/// answers are given to Claude, which writes them into the file.
/// lib/stranger-test's strangerLine, in the reader's language. The day is
/// the test's own calendar day, as the line has always shown it.
function StrangerLine({ state }: { state: StrangerState | null }) {
  const t = useTx();
  const format = useFormatter();
  if (!state) return <>{t("stranger.notRun")}</>;
  const date = format.dateTime(new Date(typeof state.at === "string" ? state.at : state.at.toISOString()), { day: "numeric", month: "numeric", timeZone: "UTC" });
  if (state.open === 0) return <>{t("stranger.passed", { date })}</>;
  const parts = [state.blockers ? t("stranger.blockers", { count: state.blockers }) : null, t("stranger.questions", { count: state.open })].filter(Boolean).join(", ");
  return <>{t("stranger.open", { parts, date })}</>;
}

export function StrangerBlock({ stranger }: { stranger: NonNullable<PanelProcess["stranger"]> }) {
  const t = useTx();
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(stranger.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The prompt is not shown; a refused clipboard leaves the button as it was.
    }
  }
  const shown = all ? stranger.open : stranger.open.slice(0, 3);
  return (
    <div className="mt-2" data-testid="process-stranger-block">
      {shown.length > 0 && (
        <ul className="space-y-1">
          {shown.map((q) => (
            <li key={q.id} className="text-[11.5px] text-app-text-secondary" data-testid="stranger-question" data-severity={q.severity}>
              <span className={q.severity === "BLOCKER" ? "font-medium text-app-error" : "font-medium text-app-text-primary"}>{t(`labels.strangerSeverity.${q.severity}`)}</span>
              {q.step ? ` · ${t("stranger.step", { step: q.step })}` : ""}
              {` · ${t(`labels.strangerAskWho.${q.askWho}`)}: `}
              <span dir="auto">{q.question}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11.5px]">
        {stranger.open.length > 3 && (
          <button type="button" onClick={() => setAll(!all)} className="text-app-text-secondary hover:underline">
            {all ? t("stranger.less") : t("stranger.more", { count: stranger.open.length - 3 })}
          </button>
        )}
        <button type="button" onClick={copy} className="font-medium text-app-text-accent hover:underline" data-testid="stranger-copy">
          {copied ? t("stranger.copied") : stranger.state ? t("stranger.copyNew") : t("stranger.copyFirst")}
        </button>
      </div>
    </div>
  );
}
