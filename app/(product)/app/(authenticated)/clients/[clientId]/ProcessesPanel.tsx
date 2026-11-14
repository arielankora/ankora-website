"use client";
import {   useState, type ReactNode } from "react";
import { useFormatter,  useTranslations } from "next-intl";
import {  Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  
  
  
  
  
  TRANSITION_LABELS,
  
  
  
  
  type KeyedCheck,
  type ProcessStep,
  
  type TransitionLike,
  type TriggerLike,
} from "@/lib/process-rules";
import {
  addProcessAction,
  
  
  
  
  resolveLessonAction,
  
  
  
  
  startProcessRunAction,
  updateProcessAction,
} from "../process-actions";
import Link from "next/link";
import {  type ReviewReason } from "@/lib/process-review";
import {  type DateCandidate,    } from "@/lib/next-steps";
import { FIELD_LABELS } from "@/lib/process-rules";
import { type StrangerAskWhoLike, type StrangerSeverityLike, type StrangerState } from "@/lib/stranger-test";
import { type CheckState } from "@/lib/process-checks";
import {  type RhythmEditorProps } from "./RhythmEditor";
import {  type LegacyDate } from "@/lib/process-rhythm";
import { type LessonStatusLike } from "@/lib/process-lessons";
import { EntitySelect, Field, INPUT, LABEL,  SourcesField,  type EntityOption, type SourceOption, ItemExtras, } from "./knowledge-ui";
import { } from "@/lib/business-calendar";

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
  runs: { id: string; title: string; status: string; dueDate: string | null; stepsDone?: number; stepsTotal?: number; waitingOn?: string | null; waitingFor?: string | null; waitingClient?: boolean; lateDays?: number | null }[];
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
/// Who does it today, in one picker: a person at Ankora, a contact at the
/// client, or words ("Nextage"). Sends the three fields the server reads.
function ExecutorPicker({ staff, contacts, existing }: { staff: Option[]; contacts: Option[]; existing?: PanelProcess }) {
  const t = useTx();
  const initial = existing?.executorUserId ? `u:${existing.executorUserId}` : existing?.executorContactId ? `c:${existing.executorContactId}` : existing?.executorText ? "text" : "";
  const [choice, setChoice] = useState(initial);
  return (
    <Field label={t("form.executor")}>
      <select value={choice} onChange={(ev) => setChoice(ev.target.value)} aria-label={t("form.executor")} className={INPUT}>
        <option value="">{t("form.notSet")}</option>
        <optgroup label={t("form.executorAnkora")}>
          {staff.map((u) => (
            <option key={u.id} value={`u:${u.id}`}>
              {u.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("form.executorClient")}>
          {contacts.map((c) => (
            <option key={c.id} value={`c:${c.id}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <option value="text">{t("form.executorOther")}</option>
      </select>
      <input type="hidden" name="executorUserId" value={choice.startsWith("u:") ? choice.slice(2) : ""} />
      <input type="hidden" name="executorContactId" value={choice.startsWith("c:") ? choice.slice(2) : ""} />
      {choice === "text" ? (
        <input name="executorText" defaultValue={existing?.executorText ?? ""} placeholder={t("form.executorTextPlaceholder")} aria-label={t("form.executorText")} className={`${INPUT} mt-2`} />
      ) : (
        <input type="hidden" name="executorText" value="" />
      )}
    </Field>
  );
}

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
  creating,
  guide,
}: {
  clientId: string;
  existing?: PanelProcess;
  only?: FormPart[];
  /// A new process from the "what" and "who" parts still needs its source.
  withSources?: boolean;
  /// After a new process is added: its id.
  onCreated?: (id: string) => void;
  /// The "new process" window (stage 2 decision, 13.11.2026): name,
  /// purpose, owner and backup, then the rhythm. Who does it is set on the
  /// process's page.
  creating?: boolean;
  /// "+ הוראת עבודה": the new item is a work guide.
  guide?: boolean;
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
      {guide && <input type="hidden" name="kind" value="GUIDE" />}
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
      <FormGroup title={t("form.groupWho")}>
        <div className={`grid gap-3.5 ${creating ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
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
          {/* Spec 4.1 (14.11.2026): who does it today is one picker, a
              person at Ankora, a contact at the client, or words. Three
              columns stay in the data. */}
          {!creating && <ExecutorPicker staff={staff} contacts={contacts} existing={e} />}
        </div>
        {/* 14.11.2026 (processes redesign, stage 5): the approver is each
            step's, set in the steps editor. The process's own stays in the
            data, read as the fallback for a step that names none. */}
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

export type FormOptions = { staff: Option[]; contacts: Option[]; systems: Option[]; rules: Option[]; entities: EntityOption[]; sourceOptions: SourceOption[] };
