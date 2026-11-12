"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CheckCircle2, Clock, Eye, EyeOff, Hourglass, Pause, Play, Share2, ShieldCheck, Undo2 } from "lucide-react";
import { MAX_PARALLEL_TIMERS } from "@/lib/app-domain/parallel-timers";
import { formatDuration } from "@/lib/time-entry-format";
import { useToast } from "@/components/app/toast/ToastProvider";
import { useActiveTimer } from "@/components/app/ActiveTimerProvider";
import { renderMarkdownLite } from "@/lib/markdown-lite";
import {
  startTimerForTaskAction,
  stopTimerForTaskAction,
  updateTaskDetailAction,
} from "./actions";
import { moveEntryIntoOpenBankAction } from "../../timer/actions";
import { TaskManualEntry } from "./TaskManualEntry";
import { waitingTitle } from "../waiting-title";
import { MESSAGE_PRIORITY_LABELS, MESSAGE_STATUS_LABELS, TaskShare, type SharePerson } from "./TaskShare";
import type { TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";
import type { AiExclusionSource } from "@/lib/ai-exclusion";

// ADR 0006: status and priority labels come from tasks.common in the
// reader's language. The share message is content for a colleague and
// keeps its Hebrew labels (MESSAGE_*_LABELS in TaskShare).
const BLOCKERS: TaskBlocker[] = ["CLIENT", "SUPPLIER", "INTERNAL", "OTHER"];

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  LOW: "bg-app-neutral-soft text-app-text-secondary",
  NORMAL: "bg-app-neutral-soft text-app-text-secondary",
  HIGH: "bg-app-warning-soft text-app-warning",
  URGENT: "bg-app-error-soft text-app-error",
};

const STATUS_OPTIONS: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "DONE", "ARCHIVED"];
const PRIORITY_OPTIONS: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

export type TaskDetailData = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  clientName: string;
  categoryId: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  requiresApproval: boolean;
  approvedByName: string | null;
  approvedAt: string | null;
  dueDate: string | null;
  clientVisible: boolean;
  clientTitle: string | null;
  clientRequest: string | null;
  /// 20.10.2026: a mapping task (Task.mappingTask). Null on a step, which
  /// has no toggle.
  mappingTask: boolean | null;
  /// 28.10.2026: the task's own "בלי AI" mark (Task.aiExcluded). Null on
  /// a step, which inherits it and has no toggle.
  aiExcluded: boolean | null;
  /// Where the effective mark comes from, or null when there is none.
  aiExclusionSource: AiExclusionSource | null;
  clientOutcome: string | null;
  /// Tasks phase 5. Null means nothing is holding this up.
  blockedOn: TaskBlocker | null;
  blockedReason: string | null;
  blockedSince: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /// Closed time reported on the task and its steps, the same number as
  /// "שעות על המשימה" further down. Shown under the timer button, where
  /// the question "how much has this taken so far" is asked.
  reportedSeconds: number;
};

export function TaskDetail({
  task,
  people,
  shareWith = [],
  taskUrl = "",
  categories,
  activeTimers,
  canApprove,
  canClearAiExclusion = false,
  leadComment = null,
  viewerId = null,
  viewerEmail = null,
}: {
  task: TaskDetailData;
  people: { id: string; name: string; email: string }[];
  /// The same people, with the WhatsApp number from their profile, for
  /// "שיתוף". Separate from `people` so the pickers never carry it.
  shareWith?: SharePerson[];
  /// The task's absolute address, for a message that leaves the app.
  taskUrl?: string;
  categories: { id: string; name: string }[];
  activeTimers: TaskActiveTimer[];
  /// Whether this person may sign this task off. Decided on the server,
  /// where the rule lives.
  canApprove: boolean;
  /// 28.10.2026: whether this person may clear "בלי AI" (a manager).
  canClearAiExclusion?: boolean;
  /// The earliest comment, shown in place of an empty description.
  leadComment?: { author: string | null; body: string } | null;
  /// Who is looking. Only used to word the urgent toast: nobody is
  /// messaged about their own task.
  viewerId?: string | null;
  /// The viewer's work address, so "שיתוף" opens the Gmail draft in that
  /// Google account even when the browser is signed in to several.
  viewerEmail?: string | null;
}) {
  const t = useTranslations("tasks.detail");
  const tc = useTranslations("tasks.common");
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  /// Which of the two panels under the header is open, if either:
  /// "דיווח ידני" or "שיתוף" (28.10.2026). One at a time.
  const [panel, setPanel] = useState<"entry" | "share" | null>(null);

  const [title, setTitle] = useState(task.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [description, setDescription] = useState(task.description ?? "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [clientVisible, setClientVisible] = useState(task.clientVisible);
  const [clientOutcome, setClientOutcome] = useState(task.clientOutcome ?? "");
  const [supervisorId, setSupervisorId] = useState(task.supervisorId ?? "");
  const [requiresApproval, setRequiresApproval] = useState(task.requiresApproval);
  const [mappingTask, setMappingTask] = useState(task.mappingTask);
  const [aiExcluded, setAiExcluded] = useState(task.aiExcluded);
  /// The status the person is trying to reach, held while they are being
  /// asked for the outcome sentence first. Null when nothing is pending.
  ///
  /// A status rather than a boolean, because phase 2 gave the sentence a
  /// second moment: submitting a client-visible promise for approval is
  /// also a person saying they are finished with it, and the supervisor
  /// about to be asked to sign needs to see what they are signing for.
  const [closingTo, setClosingTo] = useState<TaskStatus | null>(null);
  /// 19.10.2026: the task closed, but the procedure filed on it (or what
  /// a mapping task learned) was never proposed to the client file. Set
  /// from the server's answer to the close, cleared by the person.
  const [procedureReminder, setProcedureReminder] = useState<{ text: string; reviewHref: string } | null>(null);

  /// The one write path on this screen.
  ///
  /// Optimistic: local state moves first, the server is asked, and a
  /// refusal rolls every field back to what the server still holds rather
  /// than to what this component guessed. Fields the server did not
  /// answer about are left alone - `updateTask` takes a patch, so a call
  /// that changed the priority says nothing about the title.
  async function write(
    patch: Omit<Parameters<typeof updateTaskDetailAction>[0], "taskId">,
    toast: { title: string; description?: string }
  ) {
    setPending(true);
    const result = await updateTaskDetailAction({ taskId: task.id, ...patch });
    setPending(false);
    if (!result.ok) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setStatus(task.status);
      setPriority(task.priority);
      setClientVisible(task.clientVisible);
      setClientOutcome(task.clientOutcome ?? "");
      setSupervisorId(task.supervisorId ?? "");
      setRequiresApproval(task.requiresApproval);
      showToast({ tone: "error", title: t("toast.updateFailed"), description: result.error });
      return false;
    }
    setStatus(result.status);
    setClientVisible(result.clientVisible);
    setClientOutcome(result.clientOutcome ?? "");
    setSupervisorId(result.supervisorId ?? "");
    setRequiresApproval(result.requiresApproval);
    if (result.procedureReminder) setProcedureReminder(result.procedureReminder);
    showToast({ tone: "success", ...toast });
    return true;
  }

  async function changeStatus(next: TaskStatus) {
    if (next === status) return;
    // The same interception the Tasks row makes, for the same reason:
    // `assertClosable` refuses to close a promise the client can see with
    // no sentence about what came of it, so asking here is the difference
    // between a question and an error about a gesture that had no way to
    // succeed.
    const claimsFinished = next === "DONE" || next === "PENDING_APPROVAL";
    if (claimsFinished && clientVisible && !clientOutcome.trim()) {
      setClosingTo(next);
      return;
    }
    const previous = status;
    setStatus(next);
    const ok = await write({ status: next }, { title: t("toast.status", { label: tc(`status.${next}`) }), description: title });
    if (!ok) setStatus(previous);
  }

  async function confirmClose() {
    const outcome = clientOutcome.trim();
    const next = closingTo;
    if (!outcome || !next) return;
    setClosingTo(null);
    setStatus(next);
    // One call, not two. Two writes leave a window where the promise
    // carries a result and is still open, and a person who closes the tab
    // inside that window leaves it there.
    await write(
      { status: next, clientOutcome: outcome },
      {
        title: next === "DONE" ? t("toast.completed") : t("toast.sentForApproval"),
        description: outcome,
      }
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-app-border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={async () => {
                  setEditingTitle(false);
                  const next = title.trim();
                  if (!next || next === task.title) {
                    setTitle(task.title);
                    return;
                  }
                  await write({ title: next }, { title: t("toast.titleUpdated"), description: next });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setTitle(task.title);
                    setEditingTitle(false);
                  }
                }}
                className="w-full rounded-lg border border-app-border px-3 py-2 text-lg font-medium text-app-text-primary outline-none focus:border-app-accent"
              />
            ) : (
              <button
                type="button"
                dir="auto"
                onClick={() => setEditingTitle(true)}
                className="w-full text-start text-lg font-medium text-app-text-primary hover:text-app-text-secondary"
              >
                {title}
              </button>
            )}
            <p dir="auto" className="mt-1 text-[13px] text-app-text-secondary">{task.clientName}</p>
          </div>

          {/* Ariel, 19.10.2026: the timer was here, the hours it had
              already added up to were at the bottom of the screen. The
              total sits under the button and links to the breakdown.
              max-w-full, not shrink-0 (mobile check, 30.10.2026): with three
              buttons the row is wider than a 360-375px phone, and a block
              that cannot shrink never lets the row inside it wrap, so the
              whole page scrolled sideways. */}
          <div className="flex min-w-0 max-w-full flex-col items-end gap-1.5">
            {/* 28.10.2026: beside the timer, the two other things a person
                does with a task they are holding: report time the timer
                missed, and tell someone about it. */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                aria-expanded={panel === "share"}
                onClick={() => setPanel(panel === "share" ? null : "share")}
                className="flex items-center gap-2 rounded-full border border-app-border bg-white px-4 py-2 text-[13.5px] font-medium text-app-text-primary hover:border-app-border-strong"
              >
                <Share2 size={15} />
                {t("header.share")}
              </button>
              <button
                type="button"
                aria-expanded={panel === "entry"}
                onClick={() => setPanel(panel === "entry" ? null : "entry")}
                className="flex items-center gap-2 rounded-full border border-app-border bg-white px-4 py-2 text-[13.5px] font-medium text-app-text-primary hover:border-app-border-strong"
              >
                <Clock size={15} />
                {t("header.manualEntry")}
              </button>
              <TimerButton task={task} activeTimers={activeTimers} disabled={pending} />
            </div>
            <a
              href="#task-time"
              data-testid="task-reported-total"
              className="text-[12.5px] text-app-text-secondary hover:text-app-text-primary"
            >
              {task.reportedSeconds > 0
                ? t.rich("header.reportedSoFar", {
                    duration: formatDuration(task.reportedSeconds),
                    num: (chunks) => <span className="font-jbmono text-app-text-primary">{chunks}</span>,
                  })
                : t("header.nothingReported")}
            </a>
          </div>
        </div>

        {panel === "entry" && (
          <TaskManualEntry taskId={task.id} taskTitle={title} onDone={() => setPanel(null)} />
        )}
        {panel === "share" && (
          <TaskShare
            task={{
              title,
              clientName: task.clientName,
              statusLabel: MESSAGE_STATUS_LABELS[status],
              dueDate: task.dueDate,
              priorityLabel: priority === "HIGH" || priority === "URGENT" ? MESSAGE_PRIORITY_LABELS[priority] : null,
            }}
            url={taskUrl}
            people={shareWith}
            senderEmail={viewerEmail}
            defaultRecipientId={task.assignedToId && task.assignedToId !== viewerId ? task.assignedToId : null}
            onDone={() => setPanel(null)}
          />
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Select
            label={t("fields.status")}
            value={status}
            disabled={pending}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: tc(`status.${s}`) }))}
            onChange={(v) => changeStatus(v as TaskStatus)}
          />
          <Select
            label={t("fields.priority")}
            value={priority}
            disabled={pending}
            badgeClass={PRIORITY_CLASSES[priority]}
            options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: tc(`priority.${p}`) }))}
            onChange={async (v) => {
              const next = v as TaskPriority;
              const previous = priority;
              setPriority(next);
              // Raising to urgent messages the assignee now
              // (lib/app-domain/urgent-tasks.ts). Say so, so nobody has
              // to wonder whether they still need to call.
              const messaged =
                next === "URGENT" && previous !== "URGENT" && task.assignedToId && task.assignedToId !== viewerId
                  ? t("toast.urgentMessaged", { name: task.assignedToName ?? t("toast.assigneeFallback") })
                  : title;
              const ok = await write(
                { priority: next },
                { title: t("toast.priority", { label: tc(`priority.${next}`) }), description: messaged }
              );
              if (!ok) setPriority(previous);
            }}
          />
          <Select
            label={t("fields.assignee")}
            value={task.assignedToId ?? ""}
            disabled={pending}
            options={[{ value: "", label: t("fields.noAssignee") }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={async (v) => {
              const name = people.find((p) => p.id === v)?.name;
              await write(
                { assignedToId: v || null },
                { title: name ? t("toast.assignedTo", { name }) : t("toast.unassigned"), description: title }
              );
            }}
          />
          <Select
            label={t("fields.category")}
            value={task.categoryId ?? ""}
            disabled={pending}
            options={[{ value: "", label: t("fields.noCategory") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={async (v) =>
              write({ categoryId: v || null }, { title: t("toast.categoryUpdated"), description: title })
            }
          />
          <label className="flex items-center gap-2 rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary">
            {t("fields.dueDate")}
            <input
              type="date"
              aria-label={t("fields.dueDate")}
              disabled={pending}
              defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ""}
              onChange={async (e) =>
                write(
                  { dueDate: e.target.value || null },
                  { title: e.target.value ? t("toast.dueDateUpdated") : t("toast.dueDateRemoved"), description: title }
                )
              }
              className="bg-transparent text-app-text-primary outline-none"
            />
          </label>
        </div>

        {mappingTask !== null && (
          <label className="mt-4 flex w-fit items-center gap-2 rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary">
            <input
              type="checkbox"
              checked={mappingTask}
              disabled={pending}
              onChange={async (e) => {
                const next = e.target.checked;
                setMappingTask(next);
                const ok = await write(
                  { mappingTask: next },
                  {
                    title: next ? t("toast.mappingOn") : t("toast.mappingOff"),
                    description: t("toast.mappingHint"),
                  }
                );
                if (!ok) setMappingTask(!next);
              }}
              className="h-3.5 w-3.5 accent-app-text-primary"
            />
            {t("mapping.label")}
          </label>
        )}

        {/* 28.10.2026: "בלי AI". Inherited from the client or the task
            above, it is a fact here, not a toggle. */}
        {task.aiExclusionSource === "CLIENT" || task.aiExclusionSource === "PARENT_TASK" ? (
          <p className="mt-3 w-fit rounded-full border border-app-border bg-app-surface-sunken px-3 py-1.5 text-[13px] text-app-text-secondary">
            {t("ai.inherited", { source: t(`ai.source.${task.aiExclusionSource}`) })}
          </p>
        ) : (
          aiExcluded !== null && (
            <label className="mt-3 flex w-fit items-center gap-2 rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary">
              <input
                type="checkbox"
                checked={aiExcluded}
                disabled={pending || (aiExcluded && !canClearAiExclusion)}
                onChange={async (e) => {
                  const next = e.target.checked;
                  setAiExcluded(next);
                  const ok = await write(
                    { aiExcluded: next },
                    {
                      title: next ? t("toast.aiOn") : t("toast.aiOff"),
                      description: next ? t("toast.aiOnHint") : title,
                    }
                  );
                  if (!ok) setAiExcluded(!next);
                }}
                className="h-3.5 w-3.5 accent-app-text-primary"
              />
              {t("ai.label")}
              {aiExcluded && !canClearAiExclusion && <span className="text-app-text-tertiary">{t("ai.managerOnly")}</span>}
            </label>
          )
        )}

        <Timestamps task={task} />
      </section>

      <Supervision
        task={task}
        people={people}
        pending={pending}
        status={status}
        supervisorId={supervisorId}
        requiresApproval={requiresApproval}
        canApprove={canApprove}
        write={write}
        onChangeStatus={changeStatus}
      />

      <section className="rounded-2xl border border-app-border bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-app-text-secondary">{t("description.title")}</h2>
          {!editingDescription && (
            <button
              type="button"
              onClick={() => setEditingDescription(true)}
              className="text-[12.5px] text-app-text-accent hover:text-app-text-primary"
            >
              {description ? t("description.edit") : t("description.add")}
            </button>
          )}
        </div>

        {editingDescription ? (
          <div className="mt-3 space-y-2">
            <textarea
              autoFocus
              rows={7}
              dir="auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("description.placeholder")}
              className="w-full rounded-lg border border-app-border-strong px-3 py-2 text-[14px] leading-relaxed text-app-text-primary outline-none focus:border-app-accent"
            />
            {/* The subset, said once where somebody is typing it. Naming
                what is supported is cheaper than letting a person
                discover that a heading does nothing. */}
            <p className="text-[12px] text-app-text-tertiary">
              {t("description.markdownHint")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setEditingDescription(false);
                  const next = description.trim();
                  if (next === (task.description ?? "")) return;
                  await write(
                    { description: next || null },
                    { title: next ? t("toast.descriptionUpdated") : t("toast.descriptionRemoved"), description: title }
                  );
                }}
                className="rounded-full bg-app-surface-nav px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-50"
              >
                {t("description.save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDescription(task.description ?? "");
                  setEditingDescription(false);
                }}
                className="rounded-full border border-app-border px-4 py-1.5 text-[13px] text-app-text-secondary"
              >
                {t("description.cancel")}
              </button>
            </div>
          </div>
        ) : description ? (
          <div
            dir="auto"
            className="mt-3 space-y-2 text-[14px] leading-relaxed text-app-text-primary [&_p]:m-0"
            // The only dangerouslySetInnerHTML in this screen, and the
            // reason lib/markdown-lite.ts escapes the whole input before
            // it applies a single pattern. Read that file's security note
            // before changing either side of this.
            dangerouslySetInnerHTML={{ __html: renderMarkdownLite(description) }}
          />
        ) : leadComment ? (
          // No description, but somebody wrote on the task. Show that
          // rather than "אין תיאור": it is usually the whole brief.
          <div className="mt-3">
            <p className="text-xs text-app-text-tertiary">
              {leadComment.author ? t("description.fromCommentBy", { name: leadComment.author }) : t("description.fromFirstComment")}
            </p>
            <div
              dir="auto"
              className="mt-1.5 space-y-2 border-s-2 border-gold/50 ps-3 text-[14px] leading-relaxed text-app-text-primary [&_p]:m-0"
              // Same renderer, same escaping, as the description above.
              dangerouslySetInnerHTML={{ __html: renderMarkdownLite(leadComment.body) }}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-app-text-tertiary">{t("description.empty")}</p>
        )}
      </section>

      {procedureReminder && (
        <section role="status" className="rounded-2xl border border-app-warning/30 bg-app-warning-soft p-5">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-app-text-primary">
            <Hourglass size={15} className="text-app-warning" />
            {t("procedureReminder.title")}
          </p>
          <p className="mt-1 text-[12.5px] text-app-text-secondary">{procedureReminder.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              href={procedureReminder.reviewHref}
              className="rounded-full bg-app-surface-nav px-4 py-1.5 text-[13px] font-medium text-cream"
            >
              {t("procedureReminder.review")}
            </a>
            <button
              type="button"
              onClick={() => setProcedureReminder(null)}
              className="text-[12.5px] text-app-text-secondary hover:text-app-text-primary"
            >
              {t("procedureReminder.dismiss")}
            </button>
          </div>
        </section>
      )}

      <BlockSection task={task} pending={pending} write={write} isClosed={status === "DONE" || status === "ARCHIVED"} />

      <ClientSection
        task={task}
        pending={pending}
        clientVisible={clientVisible}
        clientOutcome={clientOutcome}
        setClientOutcome={setClientOutcome}
        closingTo={closingTo}
        onCancelClose={() => {
          setClosingTo(null);
          setClientOutcome(task.clientOutcome ?? "");
        }}
        onConfirmClose={confirmClose}
        write={write}
        isDone={status === "DONE"}
      />
    </div>
  );
}

/// Tasks phase 2: the second person on a task, and the signature.
///
/// A section of its own rather than two more controls in the pill row
/// above, because this is a small state machine and the row is a set of
/// independent fields. The one thing this screen owes a person here is
/// an answer to "what happens next, and is it me": whether anybody is
/// watching, whether they have to agree, and which single button moves
/// the task forward from where it is right now. Everything below is in
/// service of showing exactly one of those buttons at a time.
///
/// The rules it mirrors live in lib/app-domain/tasks.ts (assertApprovable)
/// and are enforced there. Nothing here is a permission check: this
/// decides what to show, and the server decides what is allowed. A screen
/// that guessed wrong would be confusing, not unsafe.
function Supervision({
  task,
  people,
  pending,
  status,
  supervisorId,
  requiresApproval,
  canApprove,
  write,
  onChangeStatus,
}: {
  task: TaskDetailData;
  people: { id: string; name: string; email: string }[];
  pending: boolean;
  status: TaskStatus;
  supervisorId: string;
  requiresApproval: boolean;
  canApprove: boolean;
  write: (
    patch: Omit<Parameters<typeof updateTaskDetailAction>[0], "taskId">,
    toast: { title: string; description?: string }
  ) => Promise<boolean>;
  onChangeStatus: (next: TaskStatus) => Promise<void>;
}) {
  const t = useTranslations("tasks.detail");
  const format = useFormatter();
  const waiting = status === "PENDING_APPROVAL";
  const finished = status === "DONE" || status === "ARCHIVED";
  const supervisorName = people.find((p) => p.id === supervisorId)?.name ?? task.supervisorName;

  return (
    <section className="rounded-2xl border border-app-border bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-app-text-secondary">
        <ShieldCheck size={15} strokeWidth={1.75} className="text-app-text-tertiary" />
        {t("supervision.title")}
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select
          label={t("supervision.supervisor")}
          value={supervisorId}
          disabled={pending}
          options={[{ value: "", label: t("supervision.noSupervisor") }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={async (v) => {
            const name = people.find((p) => p.id === v)?.name;
            await write(
              // Removing the supervisor of a task that requires approval
              // would leave nobody able to close it, and the server
              // refuses exactly that. Sent as one patch so the person
              // making the sensible version of that gesture is not
              // stopped: clearing the supervisor clears the requirement
              // with it.
              { supervisorId: v || null, ...(v ? {} : { requiresApproval: false }) },
              { title: name ? t("supervision.supervisorSet", { name }) : t("supervision.supervisorRemoved"), description: task.title }
            );
          }}
        />

        <label className="flex items-center gap-2 rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary">
          <input
            type="checkbox"
            checked={requiresApproval}
            disabled={pending || (!supervisorId && !requiresApproval)}
            onChange={async (e) =>
              write(
                { requiresApproval: e.target.checked },
                {
                  title: e.target.checked ? t("supervision.approvalRequired") : t("supervision.approvalNotRequired"),
                  description: task.title,
                }
              )
            }
            className="h-3.5 w-3.5 accent-app-text-primary"
          />
          {t("supervision.requiresApproval")}
        </label>
      </div>

      {/* Why the checkbox is disabled, said where somebody is trying to
          click it. A control that does nothing and explains nothing is
          the thing people file a bug about. */}
      {!supervisorId && !requiresApproval && (
        <p className="mt-2 text-[12px] text-app-text-tertiary">{t("supervision.pickSupervisorHint")}</p>
      )}

      {waiting && (
        <div className="mt-4 rounded-xl border border-app-border bg-app-surface-sunken p-4">
          {canApprove ? (
            <>
              <p className="text-[13.5px] font-medium text-app-text-primary">{t("supervision.awaitingYou")}</p>
              {task.clientOutcome && (
                <p dir="auto" className="mt-1 text-[12.5px] text-app-text-secondary">{task.clientOutcome}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onChangeStatus("DONE")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-app-surface-nav px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
                >
                  <CheckCircle2 size={14} />
                  {t("supervision.approveAndClose")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onChangeStatus("IN_PROGRESS")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-app-border px-4 py-1.5 text-[13px] text-app-text-secondary hover:text-app-text-primary disabled:opacity-40"
                >
                  <Undo2 size={14} />
                  {t("supervision.backToProgress")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-app-text-primary">
                {supervisorName ? t("supervision.awaitingNamed", { name: supervisorName }) : t("supervision.awaiting")}
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => onChangeStatus("IN_PROGRESS")}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-app-border px-4 py-1.5 text-[13px] text-app-text-secondary hover:text-app-text-primary disabled:opacity-40"
              >
                <Undo2 size={14} />
                {t("supervision.cancelSubmission")}
              </button>
            </>
          )}
        </div>
      )}

      {/* The forward move, and the only one offered while the task is
          still being worked on. Shown instead of leaving the person to
          find PENDING_APPROVAL in the status dropdown, which is the sort
          of step that turns a rule into something people route around. */}
      {!waiting && !finished && requiresApproval && (
        <button
          type="button"
          disabled={pending}
          onClick={() => onChangeStatus("PENDING_APPROVAL")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-app-surface-nav px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
        >
          <ShieldCheck size={14} />
          {t("supervision.submit")}
        </button>
      )}

      {task.approvedAt && status === "DONE" && (
        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-app-success">
          <CheckCircle2 size={14} />
          {t("supervision.approvedBy", {
            name: task.approvedByName ?? t("supervision.system"),
            date: formatDate(format, task.approvedAt),
          })}
        </p>
      )}
    </section>
  );
}

function Timestamps({ task }: { task: TaskDetailData }) {
  const t = useTranslations("tasks.detail.timestamps");
  const format = useFormatter();
  const rows: { label: string; value: string | null }[] = [
    { label: t("created"), value: task.createdAt },
    { label: t("started"), value: task.startedAt },
    { label: t("completed"), value: task.completedAt },
  ];
  return (
    <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-app-border pt-4 text-[12.5px]">
      {rows
        .filter((r) => r.value)
        .map((r) => (
          <div key={r.label} className="flex gap-1.5">
            <dt className="text-app-text-tertiary">{r.label}</dt>
            <dd className="text-app-text-secondary">{formatDate(format, r.value!)}</dd>
          </div>
        ))}
    </dl>
  );
}

/// In the reader's locale and time zone (ADR 0006).
function formatDate(format: ReturnType<typeof useFormatter>, iso: string): string {
  return format.dateTime(new Date(iso), { day: "numeric", month: "numeric", year: "2-digit" });
}

function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  badgeClass,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  badgeClass?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 rounded-full border border-app-border px-3 py-1.5 text-[13px] ${
        badgeClass ?? ""
      }`}
    >
      <span className="text-app-text-tertiary">{label}</span>
      <select
        // The visible <span> and the chosen option share this <label>, so
        // without an explicit name the accessible label would be the
        // field name plus its current value - and would change every
        // time somebody picks something else.
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent font-medium text-app-text-primary outline-none disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/// Tasks phase 5: what is holding this up.
///
/// Its own section, and not inside "מה הלקוח רואה" where the old
/// `waitingOnClient` toggle lived. Waiting stopped being a portal
/// concept the moment it could mean a supplier or an internal sign-off:
/// an internal task can be blocked too, and a control hidden behind the
/// portal switch would be a control that does not exist for half the
/// work it applies to.
///
/// **The date is shown and never asked for.** The server writes it once,
/// on the way in, so the age keeps counting while somebody corrects the
/// wording. "ממתין ללקוח, 6 ימים" is the sentence this whole feature
/// exists to be able to say.
function BlockSection({
  task,
  pending,
  write,
  isClosed,
}: {
  task: TaskDetailData;
  pending: boolean;
  write: (
    patch: Omit<Parameters<typeof updateTaskDetailAction>[0], "taskId">,
    toast: { title: string; description?: string }
  ) => Promise<boolean>;
  isClosed: boolean;
}) {
  const t = useTranslations("tasks.detail.block");
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<TaskBlocker>(task.blockedOn ?? "CLIENT");
  const [reason, setReason] = useState(task.blockedReason ?? "");

  const blocked = task.blockedOn !== null;

  async function save() {
    const ok = await write(
      { block: { on, reason: reason.trim() || null } },
      { title: t(`on.${on}`), description: reason.trim() || task.title }
    );
    if (ok) setOpen(false);
  }

  return (
    <section className="rounded-2xl border border-app-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-app-text-secondary">{t("title")}</h2>
        {blocked ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => write({ block: null }, { title: t("resumed"), description: task.title })}
            className="rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary hover:text-app-text-primary disabled:opacity-50"
          >
            {t("notWaitingAnymore")}
          </button>
        ) : (
          !isClosed && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary hover:text-app-text-primary disabled:opacity-50"
            >
              <Hourglass size={14} />
              {open ? t("cancel") : t("mark")}
            </button>
          )
        )}
      </div>

      {blocked ? (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-[13.5px] text-app-text-primary">
            <Hourglass size={15} className="text-app-warning" />
            {waitingTitle(t, task.blockedOn!, task.blockedSince)}
          </p>
          {task.blockedReason ? (
            <p dir="auto" className="mt-1 text-[12.5px] text-app-text-secondary">{task.blockedReason}</p>
          ) : (
            <p className="mt-1 text-[12.5px] text-app-text-tertiary">
              {t("noReason")}
            </p>
          )}
        </div>
      ) : isClosed ? (
        <p className="mt-2 text-[12.5px] text-app-text-tertiary">{t("closed")}</p>
      ) : (
        !open && (
          <p className="mt-2 text-[12.5px] text-app-text-secondary">
            {t("notWaiting")}
          </p>
        )
      )}

      {open && !blocked && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {BLOCKERS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={on === key}
                onClick={() => setOn(key)}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                  on === key
                    ? "border-app-warning/50 bg-app-warning-soft text-app-text-primary"
                    : "border-app-border bg-white text-app-text-secondary hover:border-gold"
                }`}
              >
                {t(`on.${key}`)}
              </button>
            ))}
          </div>
          <input
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            dir="auto"
            aria-label={t("reasonLabel")}
            placeholder={t("reasonPlaceholder")}
            className="w-full rounded-lg border border-app-border-strong px-3 py-2 text-[14px] text-app-text-primary outline-none focus:border-app-accent"
          />
          {on === "CLIENT" && task.clientVisible && (
            <p className="text-[12px] text-app-text-secondary">
              {t("clientHint")}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="rounded-full bg-app-surface-nav px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
          >
            {t("save")}
          </button>
        </div>
      )}
    </section>
  );
}

/// The three fields a client ever sees, in one place.
///
/// Rendered even when the task is internal, because the toggle that makes
/// it a promise lives here: a screen that hides the control until the
/// thing is already true is a screen nobody can use to make it true.
function ClientSection({
  task,
  pending,
  clientVisible,
  clientOutcome,
  setClientOutcome,
  closingTo,
  onCancelClose,
  onConfirmClose,
  write,
  isDone,
}: {
  task: TaskDetailData;
  pending: boolean;
  clientVisible: boolean;
  clientOutcome: string;
  setClientOutcome: (v: string) => void;
  closingTo: TaskStatus | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  write: (
    patch: Omit<Parameters<typeof updateTaskDetailAction>[0], "taskId">,
    toast: { title: string; description?: string }
  ) => Promise<boolean>;
  isDone: boolean;
}) {
  const t = useTranslations("tasks.detail.client");
  const [clientTitle, setClientTitle] = useState(task.clientTitle ?? "");
  const [clientRequest, setClientRequest] = useState(task.clientRequest ?? "");

  return (
    <section className="rounded-2xl border border-app-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-app-text-secondary">{t("title")}</h2>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            write(
              {
                clientVisible: !clientVisible,
                // Hiding a promise stops it waiting on the CLIENT: they
                // cannot answer something they can no longer see. A
                // block on a supplier survives, because it has nothing
                // to do with what the client can see.
                ...(clientVisible && task.blockedOn === "CLIENT" ? { block: null } : {}),
              },
              {
                title: clientVisible ? t("hiddenToast") : t("shownToast"),
                description: clientTitle || task.title,
              }
            )
          }
          className="flex items-center gap-1.5 rounded-full border border-app-border px-3 py-1.5 text-[13px] text-app-text-secondary hover:text-app-text-primary disabled:opacity-50"
        >
          {clientVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          {clientVisible ? t("visible") : t("internal")}
        </button>
      </div>

      {clientVisible && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[12.5px] text-app-text-tertiary">{t("titleLabel")}</label>
            <input
              dir="auto"
              value={clientTitle}
              disabled={pending}
              onChange={(e) => setClientTitle(e.target.value)}
              onBlur={async () => {
                if (clientTitle.trim() === (task.clientTitle ?? "")) return;
                await write(
                  { clientTitle: clientTitle.trim() || null },
                  { title: t("titleUpdated"), description: clientTitle.trim() || task.title }
                );
              }}
              placeholder={task.title}
              className="mt-1 w-full rounded-lg border border-app-border px-3 py-2 text-[14px] text-app-text-primary outline-none focus:border-app-accent"
            />
          </div>

          {/* The one sentence a client reads under "מחכה לך". Written to
              them, so it lives here with the other things they read, and
              not in the block reason, which stays ours. */}
          <div>
            <label className="text-[12.5px] text-app-text-tertiary">{t("requestLabel")}</label>
            <input
              dir="auto"
              value={clientRequest}
              disabled={pending}
              onChange={(e) => setClientRequest(e.target.value)}
              onBlur={async () => {
                if (clientRequest.trim() === (task.clientRequest ?? "")) return;
                await write(
                  { clientRequest: clientRequest.trim() || null },
                  { title: t("requestUpdated"), description: clientRequest.trim() || task.title }
                );
              }}
              placeholder={t("requestPlaceholder")}
              className="mt-1 w-full rounded-lg border border-app-border px-3 py-2 text-[14px] text-app-text-primary outline-none focus:border-app-accent"
            />
          </div>

          <div>
            <label className="text-[12.5px] text-app-text-tertiary">
              {isDone ? t("outcomeLabel") : t("outcomeLabelRequired")}
            </label>
            <textarea
              rows={2}
              dir="auto"
              value={clientOutcome}
              disabled={pending}
              onChange={(e) => setClientOutcome(e.target.value)}
              onBlur={async () => {
                const next = clientOutcome.trim();
                if (next === (task.clientOutcome ?? "")) return;
                // Emptying it on a closed promise is refused by the
                // server, so the screen does not send it: an empty value
                // here is a no-op rather than an error a person cannot
                // act on.
                if (!next && isDone) {
                  setClientOutcome(task.clientOutcome ?? "");
                  return;
                }
                await write(
                  { clientOutcome: next || null },
                  { title: t("outcomeUpdated"), description: next || task.title }
                );
              }}
              placeholder={t("outcomePlaceholder")}
              className="mt-1 w-full rounded-lg border border-app-border px-3 py-2 text-[14px] text-app-text-primary outline-none focus:border-app-accent"
            />
          </div>
        </div>
      )}

      {closingTo && (
        <div className="mt-4 rounded-xl border border-app-warning/30 bg-app-warning-soft p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-app-text-primary">
            <Hourglass size={15} className="text-app-warning" />
            {closingTo === "DONE" ? t("beforeClose") : t("beforeSubmit")}
          </p>
          <p className="mt-1 text-[12.5px] text-app-text-secondary">
            {t("outcomeExplainer")}
          </p>
          <textarea
            autoFocus
            rows={2}
            // Named apart from the outcome field above it: both write the
            // same column, and a test (or a screen reader) needs to know
            // which one is being answered.
            dir="auto"
            aria-label={t("outcomeBeforeCloseLabel")}
            value={clientOutcome}
            onChange={(e) => setClientOutcome(e.target.value)}
            className="mt-3 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-[14px] text-app-text-primary outline-none focus:border-app-accent"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending || !clientOutcome.trim()}
              onClick={onConfirmClose}
              className="rounded-full bg-app-surface-nav px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
            >
              {/* "סגירת המשימה", not "סגירה". Every toast in this product
                  carries a dismiss button labelled "סגירה", so the bare
                  word is ambiguous the moment one is on screen - which is
                  exactly when this button is used, since the write before
                  it raised one. A screen reader hears two identical
                  buttons that do very different things. */}
              {closingTo === "DONE" ? t("closeTask") : t("submit")}
            </button>
            <button
              type="button"
              onClick={onCancelClose}
              className="rounded-full border border-app-border px-4 py-1.5 text-[13px] text-app-text-secondary"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/// One of this person's running timers, as the task screen needs it.
export type TaskActiveTimer = {
  id: string;
  startAt: string;
  clientName: string;
  onThisTask: boolean;
  onThisClient: boolean;
};

/// Start the clock from the work, not from a picker.
///
/// A person may run two timers at once, on two different clients
/// (5.10.2026). So when something is already running, this cannot just
/// start: it asks, in the surface the person is looking at, and the
/// answer is one tap.
///
/// - A timer on this task: the button is that timer, with a stop.
/// - A timer on this task's client: a client never has two, so the only
///   offer is to stop it and start here.
/// - A timer on another client: run in parallel, or stop it and start
///   here. "In parallel" is the confirmation the domain requires.
/// - Two running: pick which one to stop.
function TimerButton({
  task,
  activeTimers,
  disabled,
}: {
  task: TaskDetailData;
  activeTimers: TaskActiveTimer[];
  disabled?: boolean;
}) {
  const t = useTranslations("tasks.detail.timer");
  const { showToast } = useToast();
  // Tells the top bar pill and the other open tabs (19.10.2026).
  const { announce } = useActiveTimer();
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const running = activeTimers.find((t) => t.onThisTask) ?? null;

  useEffect(() => {
    if (!running) return;
    const started = new Date(running.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  async function start(opts: { stopTimerId?: string; confirmParallel?: boolean }) {
    setPending(true);
    const result = await startTimerForTaskAction({ taskId: task.id, ...opts });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: t("startFailed"), description: result.error });
      return;
    }
    announce();
    showToast({
      tone: "success",
      title: opts.confirmParallel ? t("runningParallel") : t("running"),
      description: task.title,
    });
  }

  async function stop() {
    if (!running) return;
    setPending(true);
    const result = await stopTimerForTaskAction({ taskId: task.id, timeEntryId: running.id });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: t("stopFailed"), description: result.error });
      return;
    }
    announce();
    // 3.11.2026: the timer ran across its hour bank's closing.
    if (result.closedBank) {
      const timeEntryId = running.id;
      showToast({
        tone: "warning",
        title: t("stopped"),
        description: result.closedBank.message,
        ask: {
          question: t("moveQuestion"),
          choices: [
            { value: "move", label: t("move") },
            { value: "keep", label: t("keep") },
          ],
          onAnswer: async (choice) => {
            if (choice !== "move") return;
            const moved = await moveEntryIntoOpenBankAction({ timeEntryId });
            if (!moved.ok) {
              showToast({ tone: "error", title: t("moveFailed"), description: moved.error });
              return;
            }
            showToast({ tone: "success", title: t("moved"), description: t("movedHint") });
          },
        },
      });
      return;
    }
    showToast({ tone: "success", title: t("stopped"), description: task.title });
  }

  function ask() {
    if (activeTimers.length === 0) {
      void start({});
      return;
    }

    const sameClient = activeTimers.find((t) => t.onThisClient);
    if (sameClient) {
      showToast({
        tone: "warning",
        title: t("sameClientTitle"),
        description: t("sameClientDescription"),
        ask: {
          question: t("sameClientQuestion"),
          choices: [
            { value: "switch", label: t("stopAndStartHere") },
            { value: "keep", label: t("keepAsIs") },
          ],
          onAnswer: async (value) => {
            if (value === "switch") await start({ stopTimerId: sameClient.id });
          },
        },
      });
      return;
    }

    if (activeTimers.length >= MAX_PARALLEL_TIMERS) {
      showToast({
        tone: "warning",
        title: t("manyRunning", { count: activeTimers.length }),
        description: t("manyRunningDescription"),
        ask: {
          question: t("whichToStop"),
          choices: [
            ...activeTimers.map((timer) => ({ value: timer.id, label: t("stopClient", { client: timer.clientName }) })),
            { value: "keep", label: t("keepAll") },
          ],
          onAnswer: async (value) => {
            if (value !== "keep") await start({ stopTimerId: value });
          },
        },
      });
      return;
    }

    const other = activeTimers[0];
    showToast({
      tone: "warning",
      title: t("otherRunning", { client: other.clientName }),
      description: t("parallelDescription"),
      ask: {
        question: t("parallelQuestion"),
        choices: [
          { value: "parallel", label: t("runParallel") },
          { value: "switch", label: t("stopAndStartHere") },
          { value: "keep", label: t("cancel") },
        ],
        onAnswer: async (value) => {
          if (value === "parallel") await start({ confirmParallel: true });
          if (value === "switch") await start({ stopTimerId: other.id });
        },
      },
    });
  }

  if (running) {
    return (
      <button
        type="button"
        disabled={disabled || pending}
        onClick={stop}
        className="flex items-center gap-2 rounded-full bg-app-surface-nav px-4 py-2 text-[13.5px] font-medium text-cream disabled:opacity-50"
      >
        <Pause size={15} />
        <span className="font-jbmono">{formatElapsed(elapsed)}</span>
        {t("stop")}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={ask}
      className="flex items-center gap-2 rounded-full border border-app-surface-nav bg-white px-4 py-2 text-[13.5px] font-medium text-app-text-primary disabled:opacity-50"
    >
      <Play size={15} />
      {t("start")}
    </button>
  );
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

