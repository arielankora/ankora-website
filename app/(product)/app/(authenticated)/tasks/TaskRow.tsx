"use client";
import { useState } from "react";
import { Check, Eye, EyeOff, Hourglass } from "lucide-react";
import { toggleTaskDoneAction, updateTaskPortalAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import type { TaskStatus } from "@prisma/client";

// Mirrors lib/app-domain/tasks.ts's TASK_STATUS_LABELS - duplicated
// (rather than imported) because that module starts with `import
// "server-only"`, which a "use client" component can never pull in.
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};

const STATUS_TAG_CLASSES: Record<TaskStatus, string> = {
  OPEN: "bg-neutral-soft text-neutral",
  IN_PROGRESS: "bg-warning-soft text-warning",
  DONE: "bg-success-soft text-success",
  ARCHIVED: "bg-neutral-soft text-neutral",
};

const STATUS_OPTIONS: TaskStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "ARCHIVED"];

// App redesign (handoff README, screen 4 "משימות"): "שורה: תיבת סימון
// 20px (ירוקה כשהושלם), כותרת (קו חוצה + עמעום כשהושלם), לקוח · קטגוריה,
// תג סטטוס, תאריך יעד. סימון כהושלם -> טוסט עם ביטול." The checkbox is a
// dedicated one-click complete/reopen gesture (matching the spec
// exactly); the status tag next to it is kept as a real (if compact)
// select so IN_PROGRESS/ARCHIVED - which the checkbox alone can't reach -
// stay reachable, both wired through the same toggleTaskDoneAction so
// either control produces the same toast+undo behavior.
export function TaskRow({
  task,
}: {
  task: {
    id: string;
    title: string;
    clientName: string;
    categoryName: string | null;
    dueDate: string | null;
    status: TaskStatus;
    // Portal phase 1.
    clientVisible: boolean;
    clientTitle: string | null;
    waitingOnClient: boolean;
  };
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(task.status);
  const [pending, setPending] = useState(false);
  const isDone = status === "DONE";

  // Portal phase 1: the three fields that decide whether this task is a
  // promise the client can see, and what it says to them. Kept in the
  // row rather than behind a detail screen because the moment a person
  // knows a task is client-facing is the moment they are looking at it
  // in this list.
  const [clientVisible, setClientVisible] = useState(task.clientVisible);
  const [waitingOnClient, setWaitingOnClient] = useState(task.waitingOnClient);
  const [clientTitle, setClientTitle] = useState(task.clientTitle ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [portalPending, setPortalPending] = useState(false);

  async function writePortal(
    patch: { clientVisible?: boolean; clientTitle?: string | null; waitingOnClient?: boolean },
    toast: { title: string; description?: string; undo?: () => void }
  ) {
    setPortalPending(true);
    const result = await updateTaskPortalAction({ taskId: task.id, ...patch });
    setPortalPending(false);
    if (!result.ok) {
      // Roll the optimistic state back to what the server still holds.
      setClientVisible(task.clientVisible);
      setWaitingOnClient(task.waitingOnClient);
      setClientTitle(task.clientTitle ?? "");
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return;
    }
    setClientVisible(result.clientVisible);
    setWaitingOnClient(result.waitingOnClient);
    setClientTitle(result.clientTitle ?? "");
    showToast({ tone: "success", ...toast });
  }

  async function toggleVisible() {
    const next = !clientVisible;
    setClientVisible(next);
    // Hiding a task also stops it waiting: a client cannot answer
    // something they can no longer see, and leaving the flag set would
    // make it reappear as "מחכה לך" the moment it is shown again.
    if (!next) setWaitingOnClient(false);
    await writePortal(
      { clientVisible: next, ...(next ? {} : { waitingOnClient: false }) },
      {
        title: next ? "המשימה מוצגת ללקוח" : "המשימה הוסרה מהפורטל",
        description: clientTitle || task.title,
        undo: () => toggleVisible(),
      }
    );
  }

  async function toggleWaiting() {
    const next = !waitingOnClient;
    setWaitingOnClient(next);
    await writePortal(
      { waitingOnClient: next },
      {
        title: next ? "סומן כמחכה ללקוח" : "המשימה חזרה לטיפול",
        description: clientTitle || task.title,
        undo: () => toggleWaiting(),
      }
    );
  }

  async function saveTitle() {
    setEditingTitle(false);
    if ((task.clientTitle ?? "") === clientTitle.trim()) return;
    await writePortal(
      { clientTitle: clientTitle.trim() || null },
      { title: clientTitle.trim() ? "הכותרת ללקוח עודכנה" : "הכותרת ללקוח הוסרה", description: task.title }
    );
  }

  async function changeStatus(nextStatus: TaskStatus, isUndo = false) {
    const previousStatus = status;
    if (nextStatus === previousStatus) return;
    setStatus(nextStatus);
    setPending(true);
    const result = await toggleTaskDoneAction({ taskId: task.id, nextStatus });
    setPending(false);
    if (!result.ok) {
      setStatus(previousStatus);
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return;
    }
    if (isUndo) {
      showToast({ tone: "info", title: "הסימון בוטל", description: task.title });
      return;
    }
    if (nextStatus === "DONE") {
      showToast({
        tone: "success",
        title: "המשימה סומנה כהושלמה",
        description: task.title,
        undo: () => changeStatus(previousStatus, true),
      });
    } else {
      showToast({
        tone: "info",
        title: `הסטטוס עודכן ל${TASK_STATUS_LABELS[nextStatus]}`,
        description: task.title,
        undo: () => changeStatus(previousStatus, true),
      });
    }
  }

  return (
    <div className="flex items-center gap-3.5 px-[18px] py-3.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? "סימון כפתוחה" : "סימון כהושלמה"}
        disabled={pending}
        onClick={() => changeStatus(isDone ? "OPEN" : "DONE")}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors disabled:opacity-50 ${
          isDone ? "border-success bg-success" : "border-lineDark bg-white hover:border-gold"
        }`}
      >
        {isDone && <Check size={13} strokeWidth={3} className="text-white" />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13.5px] ${isDone ? "text-appNavy/40 line-through" : "text-appNavy"}`}>{task.title}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-appNavy/50">
          {task.clientName}
          {task.categoryName ? ` · ${task.categoryName}` : ""}
        </p>

        {clientVisible &&
          (editingTitle ? (
            <input
              autoFocus
              value={clientTitle}
              disabled={portalPending}
              onChange={(e) => setClientTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setClientTitle(task.clientTitle ?? "");
                  setEditingTitle(false);
                }
              }}
              placeholder="איך זה ייקרא אצל הלקוח"
              className="mt-1.5 w-full rounded-[8px] border border-lineDark bg-white px-2.5 py-1.5 text-[12px] text-appNavy outline-none focus:border-gold"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="mt-1 truncate text-[11.5px] text-gold-dim hover:underline"
            >
              {clientTitle || "הוספת כותרת ללקוח"}
            </button>
          ))}
      </div>

      {/* Portal phase 1. Two icons, not a panel: the row already carries
          five controls, and these are both binary. The hourglass only
          appears once the task is visible, because "waiting on the
          client" is meaningless for something the client cannot see. */}
      <button
        type="button"
        aria-pressed={clientVisible}
        aria-label={clientVisible ? "הסרה מהפורטל" : "הצגה ללקוח בפורטל"}
        title={clientVisible ? "מוצג ללקוח" : "לא מוצג ללקוח"}
        disabled={portalPending}
        onClick={toggleVisible}
        className={`shrink-0 rounded-full border p-1.5 transition-colors disabled:opacity-50 ${
          clientVisible ? "border-gold/50 bg-gold/12 text-appNavy" : "border-lineDark bg-white text-appNavy/35 hover:border-gold"
        }`}
      >
        {clientVisible ? <Eye size={15} strokeWidth={1.6} /> : <EyeOff size={15} strokeWidth={1.6} />}
      </button>

      {clientVisible && (
        <button
          type="button"
          aria-pressed={waitingOnClient}
          aria-label={waitingOnClient ? "הלקוח כבר לא מעכב" : "סימון כמחכה ללקוח"}
          title={waitingOnClient ? "מחכה ללקוח" : "לא מחכה ללקוח"}
          disabled={portalPending}
          onClick={toggleWaiting}
          className={`shrink-0 rounded-full border p-1.5 transition-colors disabled:opacity-50 ${
            waitingOnClient
              ? "border-warning/50 bg-warning-soft text-warning"
              : "border-lineDark bg-white text-appNavy/35 hover:border-gold"
          }`}
        >
          <Hourglass size={15} strokeWidth={1.6} />
        </button>
      )}

      <select
        value={status}
        disabled={pending}
        onChange={(e) => changeStatus(e.target.value as TaskStatus)}
        className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-medium outline-none disabled:opacity-50 ${STATUS_TAG_CLASSES[status]}`}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt} value={opt} className="bg-white text-appNavy">
            {TASK_STATUS_LABELS[opt]}
          </option>
        ))}
      </select>

      <span className="w-[72px] shrink-0 text-end text-xs text-appNavy/50">
        {task.dueDate
          ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(
              new Date(task.dueDate)
            )
          : "-"}
      </span>
    </div>
  );
}
