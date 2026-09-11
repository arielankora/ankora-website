"use client";
import { useTransition } from "react";
import { toggleAlertRuleAction, deleteAlertRuleAction } from "./actions";

export function RuleActions({ ruleId, enabled }: { ruleId: string; enabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => toggleAlertRuleAction(ruleId, !enabled))}
        className="text-xs font-medium text-navy/70 underline decoration-navy/30 underline-offset-2 disabled:opacity-50"
      >
        {enabled ? "השבתה" : "הפעלה"}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm("למחוק את כלל ההתראה? הפעולה בלתי הפיכה.")) {
            startTransition(() => deleteAlertRuleAction(ruleId));
          }
        }}
        className="text-xs font-medium text-red-600 underline decoration-red-300 underline-offset-2 disabled:opacity-50"
      >
        מחיקה
      </button>
    </div>
  );
}
