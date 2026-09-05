"use client";
import { useState, useTransition } from "react";
import { toggleReportScheduleAction, deleteReportScheduleAction, sendReportScheduleNowAction } from "./actions";

export function ScheduleActions({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [sendResult, setSendResult] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {sendResult && <span className="text-xs text-navy/60">{sendResult}</span>}
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await sendReportScheduleNowAction(scheduleId);
            setSendResult(result.ok ? "נשלח בהצלחה (בדיקה)" : `נכשל: ${result.reason ?? "שגיאה לא ידועה"}`);
          })
        }
        className="text-xs font-medium text-navy/70 underline decoration-navy/30 underline-offset-2 disabled:opacity-50"
      >
        שליחה עכשיו (בדיקה)
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => toggleReportScheduleAction(scheduleId, !enabled))}
        className="text-xs font-medium text-navy/70 underline decoration-navy/30 underline-offset-2 disabled:opacity-50"
      >
        {enabled ? "השבתה" : "הפעלה"}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm("למחוק את הדוח המתוזמן? הפעולה בלתי הפיכה.")) {
            startTransition(() => deleteReportScheduleAction(scheduleId));
          }
        }}
        className="text-xs font-medium text-red-600 underline decoration-red-300 underline-offset-2 disabled:opacity-50"
      >
        מחיקה
      </button>
    </div>
  );
}
