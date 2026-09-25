"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Hourglass, Pause, Play, ShieldCheck, Undo2 } from "lucide-react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { renderMarkdownLite } from "@/lib/markdown-lite";
import { TASK_BLOCKER_LABELS, waitingTitle } from "@/lib/app-domain/portal-labels";
import {
  startTimerForTaskAction,
  stopTimerForTaskAction,
  updateTaskDetailAction,
} from "./actions";
import type { TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";

// Mirrors the label maps in lib/app-domain/tasks.ts. Duplicated rather
// than imported for the same reason TaskRow duplicates its own: that
// module starts with `import "server-only"`, which a "use client" file
// can never pull in.
const STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
  PENDING_APPROVAL: "ממתינה לאישור",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "נמוכה",
  NORMAL: "רגילה",
  HIGH: "גבוהה",
  URGENT: "דחופה",
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  LOW: "bg-neutral-soft text-neutral",
  NORMAL: "bg-neutral-soft text-neutral",
  HIGH: "bg-warning-soft text-warning",
  URGENT: "bg-error-soft text-error",
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
  clientOutcome: string | null;
  /// Tasks phase 5. Null means nothing is holding this up.
  blockedOn: TaskBlocker | null;
  blockedReason: string | null;
  blockedSince: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export function TaskDetail({
  task,
  people,
  categories,
  activeTimer,
  canApprove,
}: {
  task: TaskDetailData;
  people: { id: string; name: string; email: string }[];
  categories: { id: string; name: string }[];
  activeTimer: { id: string; startAt: string; onThisTask: boolean } | null;
  /// Whether this person may sign this task off. Decided on the server,
  /// where the rule lives.
  canApprove: boolean;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);

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
  /// The status the person is trying to reach, held while they are being
  /// asked for the outcome sentence first. Null when nothing is pending.
  ///
  /// A status rather than a boolean, because phase 2 gave the sentence a
  /// second moment: submitting a client-visible promise for approval is
  /// also a person saying they are finished with it, and the supervisor
  /// about to be asked to sign needs to see what they are signing for.
  const [closingTo, setClosingTo] = useState<TaskStatus | null>(null);

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
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return false;
    }
    setStatus(result.status);
    setClientVisible(result.clientVisible);
    setClientOutcome(result.clientOutcome ?? "");
    setSupervisorId(result.supervisorId ?? "");
    setRequiresApproval(result.requiresApproval);
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
    const ok = await write({ status: next }, { title: `הסטטוס: ${STATUS_LABELS[next]}`, description: title });
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
        title: next === "DONE" ? "המשימה הושלמה" : "נשלחה לאישור",
        description: outcome,
      }
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-lineDark bg-white p-5">
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
                  await write({ title: next }, { title: "הכותרת עודכנה", description: next });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setTitle(task.title);
                    setEditingTitle(false);
                  }
                }}
                className="w-full rounded-lg border border-lineDark px-3 py-2 text-lg font-medium text-appNavy outline-none focus:border-appNavy/40"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="w-full text-right text-lg font-medium text-appNavy hover:text-appNavy/70"
              >
                {title}
              </button>
            )}
            <p className="mt-1 text-[13px] text-appNavy/55">{task.clientName}</p>
          </div>

          <TimerButton task={task} activeTimer={activeTimer} disabled={pending} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Select
            label="סטטוס"
            value={status}
            disabled={pending}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            onChange={(v) => changeStatus(v as TaskStatus)}
          />
          <Select
            label="עדיפות"
            value={priority}
            disabled={pending}
            badgeClass={PRIORITY_CLASSES[priority]}
            options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            onChange={async (v) => {
              const next = v as TaskPriority;
              const previous = priority;
              setPriority(next);
              const ok = await write(
                { priority: next },
                { title: `העדיפות: ${PRIORITY_LABELS[next]}`, description: title }
              );
              if (!ok) setPriority(previous);
            }}
          />
          <Select
            label="אחראי"
            value={task.assignedToId ?? ""}
            disabled={pending}
            options={[{ value: "", label: "ללא אחראי" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={async (v) => {
              const name = people.find((p) => p.id === v)?.name;
              await write(
                { assignedToId: v || null },
                { title: name ? `המשימה שויכה ל${name}` : "השיוך הוסר", description: title }
              );
            }}
          />
          <Select
            label="קטגוריה"
            value={task.categoryId ?? ""}
            disabled={pending}
            options={[{ value: "", label: "ללא קטגוריה" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={async (v) =>
              write({ categoryId: v || null }, { title: "הקטגוריה עודכנה", description: title })
            }
          />
          <label className="flex items-center gap-2 rounded-full border border-lineDark px-3 py-1.5 text-[13px] text-appNavy/60">
            תאריך יעד
            <input
              type="date"
              aria-label="תאריך יעד"
              disabled={pending}
              defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ""}
              onChange={async (e) =>
                write(
                  { dueDate: e.target.value || null },
                  { title: e.target.value ? "תאריך היעד עודכן" : "תאריך היעד הוסר", description: title }
                )
              }
              className="bg-transparent text-appNavy outline-none"
            />
          </label>
        </div>

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

      <section className="rounded-2xl border border-lineDark bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-appNavy/70">תיאור</h2>
          {!editingDescription && (
            <button
              type="button"
              onClick={() => setEditingDescription(true)}
              className="text-[12.5px] text-gold-dim hover:text-appNavy"
            >
              {description ? "עריכה" : "הוספת תיאור"}
            </button>
          )}
        </div>

        {editingDescription ? (
          <div className="mt-3 space-y-2">
            <textarea
              autoFocus
              rows={7}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="מה צריך לעשות, כתובת, מספר אסמכתא, מה כבר נוסה."
              className="w-full rounded-lg border border-lineDark px-3 py-2 text-[14px] leading-relaxed text-appNavy outline-none focus:border-appNavy/40"
            />
            {/* The subset, said once where somebody is typing it. Naming
                what is supported is cheaper than letting a person
                discover that a heading does nothing. */}
            <p className="text-[12px] text-appNavy/45">
              אפשר **מודגש**, *נטוי*, `קוד`, רשימות עם - או 1. וקישורים [טקסט](כתובת).
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
                    { title: next ? "התיאור עודכן" : "התיאור הוסר", description: title }
                  );
                }}
                className="rounded-full bg-appNavy px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-50"
              >
                שמירה
              </button>
              <button
                type="button"
                onClick={() => {
                  setDescription(task.description ?? "");
                  setEditingDescription(false);
                }}
                className="rounded-full border border-lineDark px-4 py-1.5 text-[13px] text-appNavy/60"
              >
                ביטול
              </button>
            </div>
          </div>
        ) : description ? (
          <div
            className="mt-3 space-y-2 text-[14px] leading-relaxed text-appNavy/85 [&_p]:m-0"
            // The only dangerouslySetInnerHTML in this screen, and the
            // reason lib/markdown-lite.ts escapes the whole input before
            // it applies a single pattern. Read that file's security note
            // before changing either side of this.
            dangerouslySetInnerHTML={{ __html: renderMarkdownLite(description) }}
          />
        ) : (
          <p className="mt-3 text-sm text-appNavy/45">אין תיאור. כל מה שנמצא היום בוואטסאפ שייך לכאן.</p>
        )}
      </section>

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
  const waiting = status === "PENDING_APPROVAL";
  const finished = status === "DONE" || status === "ARCHIVED";
  const supervisorName = people.find((p) => p.id === supervisorId)?.name ?? task.supervisorName;

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-appNavy/70">
        <ShieldCheck size={15} strokeWidth={1.75} className="text-appNavy/40" />
        פיקוח ואישור
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select
          label="מפקח"
          value={supervisorId}
          disabled={pending}
          options={[{ value: "", label: "ללא מפקח" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
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
              { title: name ? `${name} מפקח על המשימה` : "הפיקוח הוסר", description: task.title }
            );
          }}
        />

        <label className="flex items-center gap-2 rounded-full border border-lineDark px-3 py-1.5 text-[13px] text-appNavy/60">
          <input
            type="checkbox"
            checked={requiresApproval}
            disabled={pending || (!supervisorId && !requiresApproval)}
            onChange={async (e) =>
              write(
                { requiresApproval: e.target.checked },
                {
                  title: e.target.checked ? "המשימה תדרוש אישור" : "המשימה לא דורשת אישור",
                  description: task.title,
                }
              )
            }
            className="h-3.5 w-3.5 accent-appNavy"
          />
          דורשת אישור לפני סגירה
        </label>
      </div>

      {/* Why the checkbox is disabled, said where somebody is trying to
          click it. A control that does nothing and explains nothing is
          the thing people file a bug about. */}
      {!supervisorId && !requiresApproval && (
        <p className="mt-2 text-[12px] text-appNavy/45">בחרו מפקח כדי לדרוש אישור.</p>
      )}

      {waiting && (
        <div className="mt-4 rounded-xl border border-lineDark bg-appNavy/[0.04] p-4">
          {canApprove ? (
            <>
              <p className="text-[13.5px] font-medium text-appNavy">המשימה מחכה לאישור שלך.</p>
              {task.clientOutcome && (
                <p className="mt-1 text-[12.5px] text-appNavy/60">{task.clientOutcome}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onChangeStatus("DONE")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-appNavy px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
                >
                  <CheckCircle2 size={14} />
                  אישור וסגירה
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onChangeStatus("IN_PROGRESS")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-lineDark px-4 py-1.5 text-[13px] text-appNavy/70 hover:text-appNavy disabled:opacity-40"
                >
                  <Undo2 size={14} />
                  החזרה לביצוע
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-appNavy">
                {supervisorName ? `ממתינה לאישור של ${supervisorName}.` : "ממתינה לאישור."}
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => onChangeStatus("IN_PROGRESS")}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-lineDark px-4 py-1.5 text-[13px] text-appNavy/70 hover:text-appNavy disabled:opacity-40"
              >
                <Undo2 size={14} />
                ביטול השליחה
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
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-appNavy px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
        >
          <ShieldCheck size={14} />
          שליחה לאישור
        </button>
      )}

      {task.approvedAt && status === "DONE" && (
        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-success">
          <CheckCircle2 size={14} />
          אושרה על ידי {task.approvedByName ?? "המערכת"} ב{formatDate(task.approvedAt)}
        </p>
      )}
    </section>
  );
}

function Timestamps({ task }: { task: TaskDetailData }) {
  const rows: { label: string; value: string | null }[] = [
    { label: "נפתחה", value: task.createdAt },
    { label: "יצאה לדרך", value: task.startedAt },
    { label: "הושלמה", value: task.completedAt },
  ];
  return (
    <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-lineDark pt-4 text-[12.5px]">
      {rows
        .filter((r) => r.value)
        .map((r) => (
          <div key={r.label} className="flex gap-1.5">
            <dt className="text-appNavy/45">{r.label}</dt>
            <dd className="text-appNavy/70">{formatDate(r.value!)}</dd>
          </div>
        ))}
    </dl>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
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
      className={`flex items-center gap-2 rounded-full border border-lineDark px-3 py-1.5 text-[13px] ${
        badgeClass ?? ""
      }`}
    >
      <span className="text-appNavy/50">{label}</span>
      <select
        // The visible <span> and the chosen option share this <label>, so
        // without an explicit name the accessible label would be the
        // field name plus its current value - and would change every
        // time somebody picks something else.
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent font-medium text-appNavy outline-none disabled:opacity-50"
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
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<TaskBlocker>(task.blockedOn ?? "CLIENT");
  const [reason, setReason] = useState(task.blockedReason ?? "");

  const blocked = task.blockedOn !== null;

  async function save() {
    const ok = await write(
      { block: { on, reason: reason.trim() || null } },
      { title: TASK_BLOCKER_LABELS[on], description: reason.trim() || task.title }
    );
    if (ok) setOpen(false);
  }

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-appNavy/70">ממתינים למשהו?</h2>
        {blocked ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => write({ block: null }, { title: "המשימה חזרה לטיפול", description: task.title })}
            className="rounded-full border border-lineDark px-3 py-1.5 text-[13px] text-appNavy/70 hover:text-appNavy disabled:opacity-50"
          >
            כבר לא ממתינים
          </button>
        ) : (
          !isClosed && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-lineDark px-3 py-1.5 text-[13px] text-appNavy/70 hover:text-appNavy disabled:opacity-50"
            >
              <Hourglass size={14} />
              {open ? "ביטול" : "סימון כממתין"}
            </button>
          )
        )}
      </div>

      {blocked ? (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-[13.5px] text-appNavy">
            <Hourglass size={15} className="text-warning" />
            {waitingTitle(task.blockedOn!, task.blockedSince)}
          </p>
          {task.blockedReason ? (
            <p className="mt-1 text-[12.5px] text-appNavy/60">{task.blockedReason}</p>
          ) : (
            <p className="mt-1 text-[12.5px] text-appNavy/45">
              לא נכתבה סיבה. מי שיפתח את המשימה בעוד שבוע לא ידע למה היא עצרה.
            </p>
          )}
        </div>
      ) : isClosed ? (
        <p className="mt-2 text-[12.5px] text-appNavy/45">משימה שהושלמה לא ממתינה לאף אחד.</p>
      ) : (
        !open && (
          <p className="mt-2 text-[12.5px] text-appNavy/55">
            לא ממתינה לאף אחד. אם העבודה עצרה כי מחכים לתשובה, כדאי לסמן: המדד של ההבטחות התקועות
            מפריד בין מה שתקוע אצלנו למה שתקוע אצלם.
          </p>
        )
      )}

      {open && !blocked && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TASK_BLOCKER_LABELS) as TaskBlocker[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={on === key}
                onClick={() => setOn(key)}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                  on === key
                    ? "border-warning/50 bg-warning-soft text-appNavy"
                    : "border-lineDark bg-white text-appNavy/60 hover:border-gold"
                }`}
              >
                {TASK_BLOCKER_LABELS[key]}
              </button>
            ))}
          </div>
          <input
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            aria-label="סיבת ההמתנה"
            placeholder="למה עצרנו, במשפט. לא חובה, ושווה."
            className="w-full rounded-lg border border-lineDark px-3 py-2 text-[14px] text-appNavy outline-none focus:border-appNavy/40"
          />
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="rounded-full bg-appNavy px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
          >
            שמירה
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
  const [clientTitle, setClientTitle] = useState(task.clientTitle ?? "");

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-appNavy/70">מה הלקוח רואה</h2>
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
                title: clientVisible ? "המשימה הוסרה מהפורטל" : "המשימה מוצגת ללקוח",
                description: clientTitle || task.title,
              }
            )
          }
          className="flex items-center gap-1.5 rounded-full border border-lineDark px-3 py-1.5 text-[13px] text-appNavy/70 hover:text-appNavy disabled:opacity-50"
        >
          {clientVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          {clientVisible ? "מוצגת בפורטל" : "פנימית"}
        </button>
      </div>

      {clientVisible && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[12.5px] text-appNavy/50">הכותרת שהלקוח קורא</label>
            <input
              value={clientTitle}
              disabled={pending}
              onChange={(e) => setClientTitle(e.target.value)}
              onBlur={async () => {
                if (clientTitle.trim() === (task.clientTitle ?? "")) return;
                await write(
                  { clientTitle: clientTitle.trim() || null },
                  { title: "הכותרת ללקוח עודכנה", description: clientTitle.trim() || task.title }
                );
              }}
              placeholder={task.title}
              className="mt-1 w-full rounded-lg border border-lineDark px-3 py-2 text-[14px] text-appNavy outline-none focus:border-appNavy/40"
            />
          </div>

          <div>
            <label className="text-[12.5px] text-appNavy/50">
              משפט התוצאה{isDone ? "" : " (נדרש כדי לסגור)"}
            </label>
            <textarea
              rows={2}
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
                  { title: "משפט התוצאה עודכן", description: next || task.title }
                );
              }}
              placeholder="במשפט אחד, בשפה של הלקוח: מה קרה בפועל."
              className="mt-1 w-full rounded-lg border border-lineDark px-3 py-2 text-[14px] text-appNavy outline-none focus:border-appNavy/40"
            />
          </div>
        </div>
      )}

      {closingTo && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-appNavy">
            <Hourglass size={15} className="text-warning" />
            {closingTo === "DONE" ? "לפני הסגירה: מה קרה בפועל?" : "לפני השליחה לאישור: מה קרה בפועל?"}
          </p>
          <p className="mt-1 text-[12.5px] text-appNavy/60">
            המשפט הזה הוא מה שהלקוח קורא בפורטל ומה שנכנס לסיכום החודשי.
          </p>
          <textarea
            autoFocus
            rows={2}
            // Named apart from the outcome field above it: both write the
            // same column, and a test (or a screen reader) needs to know
            // which one is being answered.
            aria-label="משפט התוצאה לפני סגירה"
            value={clientOutcome}
            onChange={(e) => setClientOutcome(e.target.value)}
            className="mt-3 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-[14px] text-appNavy outline-none focus:border-appNavy/40"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending || !clientOutcome.trim()}
              onClick={onConfirmClose}
              className="rounded-full bg-appNavy px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
            >
              {/* "סגירת המשימה", not "סגירה". Every toast in this product
                  carries a dismiss button labelled "סגירה", so the bare
                  word is ambiguous the moment one is on screen - which is
                  exactly when this button is used, since the write before
                  it raised one. A screen reader hears two identical
                  buttons that do very different things. */}
              {closingTo === "DONE" ? "סגירת המשימה" : "שליחה לאישור"}
            </button>
            <button
              type="button"
              onClick={onCancelClose}
              className="rounded-full border border-lineDark px-4 py-1.5 text-[13px] text-appNavy/60"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/// Start the clock from the work, not from a picker.
///
/// Three states, and the third is the only interesting one. The product
/// holds one active timer per person (a partial unique index, not a
/// convention), so when another timer is already running this cannot just
/// start: it says what is running and offers to swap in one click, which
/// is the same shape the timer screen uses for the same collision.
function TimerButton({
  task,
  activeTimer,
  disabled,
}: {
  task: TaskDetailData;
  activeTimer: { id: string; startAt: string; onThisTask: boolean } | null;
  disabled?: boolean;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const running = activeTimer?.onThisTask ? activeTimer : null;

  useEffect(() => {
    if (!running) return;
    const started = new Date(running.startAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  async function start(stopRunning: boolean) {
    setPending(true);
    const result = await startTimerForTaskAction({ taskId: task.id, stopRunning });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "הטיימר לא הופעל", description: result.error });
      return;
    }
    showToast({ tone: "success", title: "הטיימר רץ", description: task.title });
  }

  async function stop() {
    if (!running) return;
    setPending(true);
    const result = await stopTimerForTaskAction({ taskId: task.id, timeEntryId: running.id });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "העצירה נכשלה", description: result.error });
      return;
    }
    showToast({ tone: "success", title: "הטיימר נעצר", description: task.title });
  }

  if (running) {
    return (
      <button
        type="button"
        disabled={disabled || pending}
        onClick={stop}
        className="flex items-center gap-2 rounded-full bg-appNavy px-4 py-2 text-[13.5px] font-medium text-cream disabled:opacity-50"
      >
        <Pause size={15} />
        <span className="font-jbmono">{formatElapsed(elapsed)}</span>
        עצירה
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        if (!activeTimer) {
          void start(false);
          return;
        }
        // Another timer is running. Not an error to show after the fact:
        // the question is asked first, in the surface the person is
        // already looking at, and answering it is one tap.
        showToast({
          tone: "warning",
          title: "כבר רץ טיימר אחר",
          description: "אפשר לעצור אותו ולהתחיל כאן.",
          ask: {
            question: "לעצור את הטיימר הפעיל ולהתחיל על המשימה הזו?",
            choices: [
              { value: "switch", label: "לעצור ולהתחיל כאן" },
              { value: "keep", label: "להשאיר כמו שהוא" },
            ],
            onAnswer: async (value) => {
              if (value === "switch") await start(true);
            },
          },
        });
      }}
      className="flex items-center gap-2 rounded-full border border-appNavy bg-white px-4 py-2 text-[13.5px] font-medium text-appNavy disabled:opacity-50"
    >
      <Play size={15} />
      הפעלת טיימר
    </button>
  );
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
