"use client";
import { useTransition } from "react";
import { retryEmailDeliveryAction } from "./actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { useTranslations } from "next-intl";

// App redesign (handoff README, Interactions & Behavior rule 5): "כשלון
// אמיתי נשאר כשלון: 'שליחה חוזרת' בהיסטוריית ההתראות מחזירה טוסט שגיאה עם
// הסיבה." Previously silent (no toast at all, success or failure).
export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  const { showToast } = useToast();
  const t = useTranslations("alerts.retry");
  const [isPending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await retryEmailDeliveryAction(deliveryId);
      showToast(
        result.ok
          ? { tone: "success", title: t("succeeded") }
          : { tone: "error", title: t("failedAgain"), description: result.error }
      );
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={retry}
      className="text-[11px] font-medium text-app-text-accent underline decoration-gold/40 underline-offset-2 disabled:opacity-50"
    >
      {isPending ? t("sending") : t("retry")}
    </button>
  );
}
