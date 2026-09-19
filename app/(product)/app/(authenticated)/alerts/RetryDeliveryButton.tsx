"use client";
import { useTransition } from "react";
import { retryEmailDeliveryAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";

// App redesign (handoff README, Interactions & Behavior rule 5): "כשלון
// אמיתי נשאר כשלון: 'שליחה חוזרת' בהיסטוריית ההתראות מחזירה טוסט שגיאה עם
// הסיבה." Previously silent (no toast at all, success or failure).
export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await retryEmailDeliveryAction(deliveryId);
      showToast(
        result.ok
          ? { tone: "success", title: "השליחה הצליחה" }
          : { tone: "error", title: "השליחה נכשלה שוב", description: result.error }
      );
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={retry}
      className="text-[11px] font-medium text-gold underline decoration-gold/40 underline-offset-2 disabled:opacity-50"
    >
      {isPending ? "שולח..." : "ניסיון חוזר"}
    </button>
  );
}
