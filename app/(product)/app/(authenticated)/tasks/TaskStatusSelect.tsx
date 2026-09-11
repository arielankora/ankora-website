"use client";
import { useRef, useTransition } from "react";
import { updateTaskStatusAction } from "./actions";
import type { TaskStatus } from "@prisma/client";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "OPEN", label: "פתוחה" },
  { value: "IN_PROGRESS", label: "בביצוע" },
  { value: "DONE", label: "הושלמה" },
  { value: "ARCHIVED", label: "בארכיון" },
];

/// Inline status-change control for one Task row - auto-submits on
/// selection, mirroring the same "no extra confirm click" pattern
/// app/(product)/app/categories's archive button uses for a single action.
export function TaskStatusSelect({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) => startTransition(() => updateTaskStatusAction(fd))}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <select
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-lineDark bg-white px-2 py-1 text-xs text-navy outline-none focus:border-gold disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}
