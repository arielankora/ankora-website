"use client";
import { useState, useTransition } from "react";
import { toggleReportScheduleAction, deleteReportScheduleAction, sendReportScheduleNowAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { Switch } from "@/components/app/Switch";

// App redesign (handoff README, screen 12 "דוחות מתוזמנים"): the
// prototype's per-schedule row has a real on/off switch (42x24px, per the
// Responsive section) and a "שליחה עכשיו" button - replacing the old plain
// "השבתה/הפעלה" text link, and adding the toast+undo the Interactions &
// Behavior rules require for disabling a schedule (rule 2's "כיבוי ...
// תזמון"). Deletion has no real undo available (ReportSchedule.delete is a
// hard delete, not soft - see lib/app-domain/report-schedules.ts), so it
// keeps its confirm() guard and gets a plain success/failure toast instead
// of a fabricated one.
export function ScheduleActions({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(enabled);
  const [sending, setSending] = useState(false);

  function toggle(next: boolean, isUndo = false) {
    setChecked(next);
    startTransition(async () => {
      const result = await toggleReportScheduleAction(scheduleId, next);
      if (!result.ok) {
        setChecked(!next);
        showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
        return;
      }
      if (isUndo) return;
      showToast({
        tone: next ? "success" : "warning",
        title: next ? "הדוח המתוזמן הופעל" : "הדוח המתוזמן הושבת",
        undo: () => toggle(!next, true),
      });
    });
  }

  async function handleSendNow() {
    setSending(true);
    const result = await sendReportScheduleNowAction(scheduleId);
    setSending(false);
    showToast(
      result.ok
        ? { tone: "success", title: "נשלח בהצלחה (בדיקה)" }
        : { tone: "error", title: "השליחה נכשלה", description: result.reason ?? "שגיאה לא ידועה" }
    );
  }

  function handleDelete() {
    if (!confirm("למחוק את הדוח המתוזמן? הפעולה בלתי הפיכה.")) return;
    startTransition(async () => {
      const result = await deleteReportScheduleAction(scheduleId);
      showToast(
        result.ok
          ? { tone: "success", title: "הדוח המתוזמן נמחק" }
          : { tone: "error", title: "המחיקה נכשלה", description: result.error }
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <button
        type="button"
        disabled={sending}
        onClick={handleSendNow}
        className="rounded-full border border-lineDark px-3.5 py-2 text-xs text-appNavy transition-colors hover:border-gold disabled:opacity-50"
      >
        {sending ? "שולח..." : "שליחה עכשיו"}
      </button>
      <Switch checked={checked} onChange={() => toggle(!checked)} disabled={isPending} label="הפעלה או כיבוי" />
      <button
        type="button"
        disabled={isPending}
        onClick={handleDelete}
        className="text-xs font-medium text-error/80 underline decoration-error/30 underline-offset-2 disabled:opacity-50"
      >
        מחיקה
      </button>
    </div>
  );
}
