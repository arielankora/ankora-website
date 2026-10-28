"use client";
import { useEffect, useRef, useState } from "react";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { BackdateReasonField, OverlapNotice, todayKey } from "../../my-time/ManualEntryParts";
import { createTaskManualEntryAction } from "./actions";

const FIELD =
  "w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold";

// 28.10.2026: "דיווח ידני" beside the timer, for time the timer missed.
//
// The one-line form from "הזמן שלי" without its client and category,
// which are the task's (the server reads them from the task, not from
// here). The note starts as the task's title, the same line the timer
// writes, and is the line the client's monthly report shows.
export function TaskManualEntry({
  taskId,
  taskTitle,
  onDone,
}: {
  taskId: string;
  taskTitle: string;
  onDone: () => void;
}) {
  const { onSubmit, pending, result } = useActionForm(createTaskManualEntryAction);
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const confirmOverlapRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayKey());
  const [warningDismissed, setWarningDismissed] = useState(false);
  const isBackdated = date !== todayKey();

  useEffect(() => {
    if (result?.overlapWarning) setWarningDismissed(false);
    // Sticky across submits, like the same flag in ManualEntryForm.
    if (confirmOverlapRef.current && (result?.ok || result?.error)) confirmOverlapRef.current.value = "false";
    if (!result?.ok) return;
    showToast({ tone: "success", title: "הדיווח נשמר", description: taskTitle });
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function saveAnyway() {
    if (confirmOverlapRef.current) confirmOverlapRef.current.value = "true";
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      data-testid="task-manual-entry"
      className="mt-4 rounded-xl border border-app-border bg-app-surface-sunken p-4"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <input ref={confirmOverlapRef} type="hidden" name="confirmOverlap" defaultValue="false" />
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block" style={{ flex: "0 0 150px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">תאריך</span>
          <input
            type="date"
            name="date"
            required
            max={todayKey()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD}
          />
        </label>
        <label className="block" style={{ flex: "0 0 108px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">מ־</span>
          <input type="time" name="startTime" required className={FIELD} />
        </label>
        <label className="block" style={{ flex: "0 0 108px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">עד</span>
          <input type="time" name="endTime" required className={FIELD} />
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 200px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">הערה</span>
          <input name="note" defaultValue={taskTitle} placeholder="מה נעשה עבור הלקוח?" className={FIELD} />
        </label>
        <div className="flex shrink-0 items-center gap-2" style={{ marginInlineStart: "auto" }}>
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-3 py-2.5 text-sm text-app-text-secondary hover:text-app-text-primary"
          >
            ביטול
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
          >
            {pending ? "שומר..." : "שמירת דיווח"}
          </button>
        </div>
      </div>

      {isBackdated && <BackdateReasonField />}
      {result?.overlapWarning && !warningDismissed && (
        <OverlapNotice warning={result.overlapWarning} onSaveAnyway={saveAnyway} onDismiss={() => setWarningDismissed(true)} />
      )}
      {result?.error && (
        <p className="mt-3 rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2.5 text-[12.5px] text-app-error">
          {result.error}
        </p>
      )}
    </form>
  );
}
