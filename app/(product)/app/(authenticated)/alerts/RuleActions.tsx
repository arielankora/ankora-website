"use client";
import { useState, useTransition } from "react";
import { toggleAlertRuleAction, deleteAlertRuleAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { Switch } from "@/components/app/Switch";

// App redesign (handoff README, screen 13 "התראות" + Interactions &
// Behavior rule 2): real 42x24px switch (see components/app/Switch.tsx)
// with a toast+undo on toggle, replacing the old silent text-link toggle.
// Deletion has no real undo (AlertRule.delete is a hard delete), so it
// keeps its confirm() guard and gets a plain outcome toast.
export function RuleActions({ ruleId, enabled }: { ruleId: string; enabled: boolean }) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(enabled);

  function toggle(next: boolean, isUndo = false) {
    setChecked(next);
    startTransition(async () => {
      const result = await toggleAlertRuleAction(ruleId, next);
      if (!result.ok) {
        setChecked(!next);
        showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
        return;
      }
      if (isUndo) return;
      showToast({
        tone: next ? "success" : "warning",
        title: next ? "כלל ההתראה הופעל" : "כלל ההתראה הושבת",
        undo: () => toggle(!next, true),
      });
    });
  }

  function handleDelete() {
    if (!confirm("למחוק את כלל ההתראה? הפעולה בלתי הפיכה.")) return;
    startTransition(async () => {
      const result = await deleteAlertRuleAction(ruleId);
      showToast(
        result.ok
          ? { tone: "success", title: "כלל ההתראה נמחק" }
          : { tone: "error", title: "המחיקה נכשלה", description: result.error }
      );
    });
  }

  return (
    <div className="flex items-center gap-3.5">
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
