"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Hourglass, Pause, Play } from "lucide-react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { renderMarkdownLite } from "@/lib/markdown-lite";
import {
  startTimerForTaskAction,
  stopTimerForTaskAction,
  updateTaskDetailAction,
} from "./actions";
import type { TaskPriority, TaskStatus } from "@prisma/client";

// Mirrors the label maps in lib/app-domain/tasks.ts. Duplicated rather
// than imported for the same reason TaskRow duplicates its own: that
// module starts with `import "server-only"`, which a "use client" file
// can never pull in.
const STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
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

const STATUS_OPTIONS: TaskStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "ARCHIVED"];
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
  dueDate: string | null;
  clientVisible: boolean;
  clientTitle: string | null;
  clientOutcome: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export function TaskDetail({
  task,
  people,
  categories,
  activeTimer,
}: {
  task: TaskDetailData;
  people: { id: string; name: string; email: string }[];
  categories: { id: string; name: string }[];
  activeTimer: { id: string; startAt: string; onThisTask: boolean } | null;
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
  const [closing, setClosing] = useState(false);

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
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return false;
    }
    setStatus(result.status);
    setClientVisible(result.clientVisible);
    setClientOutcome(result.clientOutcome ?? "");
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
    if (next === "DONE" && clientVisible && !clientOutcome.trim()) {
      setClosing(true);
      return;
    }
    const previous = status;
    setStatus(next);
    const ok = await write({ status: next }, { title: `הסטטוס: ${STATUS_LABELS[next]}`, description: title });
    if (!ok) setStatus(previous);
  }

  async function confirmClose() {
    const outcome = clientOutcome.trim();
    if (!outcome) return;
    setClosing(false);
    setStatus("DONE");
    // One call, not two. Two writes leave a window where the promise
    // carries a result and is still open, and a person who closes the tab
    // inside that window leaves it there.
    await write({ status: "DONE", clientOutcome: outcome }, { title: "המשימה הושלמה", description: outcome });
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

      <ClientSection
        task={task}
        pending={pending}
        clientVisible={clientVisible}
        clientOutcome={clientOutcome}
        setClientOutcome={setClientOutcome}
        closing={closing}
        onCancelClose={() => {
          setClosing(false);
          setClientOutcome(task.clientOutcome ?? "");
        }}
        onConfirmClose={confirmClose}
        write={write}
        isDone={status === "DONE"}
      />
    </div>
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
  closing,
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
  closing: boolean;
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
              { clientVisible: !clientVisible, ...(clientVisible ? { waitingOnClient: false } : {}) },
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

      {closing && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-appNavy">
            <Hourglass size={15} className="text-warning" />
            לפני הסגירה: מה קרה בפועל?
          </p>
          <p className="mt-1 text-[12.5px] text-appNavy/60">
            המשפט הזה הוא מה שהלקוח קורא בפורטל ומה שנכנס לסיכום החודשי.
          </p>
          <textarea
            autoFocus
            rows={2}
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
              סגירה
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
