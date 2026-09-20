"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { toggleTaskDoneAction } from "./actions";
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
  task: { id: string; title: string; clientName: string; categoryName: string | null; dueDate: string | null; status: TaskStatus };
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(task.status);
  const [pending, setPending] = useState(false);
  const isDone = status === "DONE";

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
      </div>

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
