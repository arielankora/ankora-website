"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/app/Switch";
import { useToast } from "@/components/app/toast/ToastProvider";
import { updateDailyDigestPreferenceAction, updateNotificationPreferenceAction } from "./actions";

// Kept in sync with lib/app-domain/reports.ts's LONG_TIMER_HOURS (8) - not
// imported directly so this client component doesn't pull a server-only
// module into the browser bundle just for one number (same precedent as
// ResetPasswordForm.tsx's MIN_LENGTH).
const LONG_TIMER_HOURS = 8;

// App redesign (handoff README, screen 18 "התראות אישיות"): the prototype
// shows a full list of toggle rows; this app only has one real
// notification preference behind it today (see schema.prisma's
// notifyLongRunningTimerByEmail and lib/app-domain/notifications.ts's
// notifyLongRunningTimers) so this renders exactly one real row rather
// than several invented ones. Same optimistic-toggle + toast + undo
// pattern as ScheduleActions.tsx/RuleActions.tsx.
export function DailyDigestPreferenceForm({ enabled }: { enabled: boolean }) {
  const t = useTranslations("profile.notifications");
  const { showToast } = useToast();
  const [, startTransition] = useTransition();
  const [checked, setChecked] = useState(enabled);

  function toggle(next: boolean, isUndo = false) {
    setChecked(next);
    startTransition(async () => {
      const result = await updateDailyDigestPreferenceAction(next);
      if (!result.ok) {
        setChecked(!next);
        showToast({ tone: "error", title: t("updateFailed"), description: result.error });
        return;
      }
      if (isUndo) return;
      showToast({
        tone: "success",
        title: next ? t("digestOn") : t("digestOff"),
        undo: () => toggle(!next, true),
      });
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm text-app-text-primary">{t("digestTitle")}</p>
        <p className="mt-0.5 text-xs text-app-text-tertiary">{t("digestHint")}</p>
      </div>
      <Switch checked={checked} onChange={() => toggle(!checked)} label={t("digestTitle")} />
    </div>
  );
}

export function NotificationPreferenceForm({ enabled }: { enabled: boolean }) {
  const t = useTranslations("profile.notifications");
  const { showToast } = useToast();
  const [, startTransition] = useTransition();
  const [checked, setChecked] = useState(enabled);

  function toggle(next: boolean, isUndo = false) {
    setChecked(next);
    startTransition(async () => {
      const result = await updateNotificationPreferenceAction(next);
      if (!result.ok) {
        setChecked(!next);
        showToast({ tone: "error", title: t("updateFailed"), description: result.error });
        return;
      }
      if (isUndo) return;
      showToast({
        tone: "success",
        title: next ? t("longTimerOn") : t("longTimerOff"),
        undo: () => toggle(!next, true),
      });
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm text-app-text-primary">{t("longTimerTitle")}</p>
        <p className="mt-0.5 text-xs text-app-text-tertiary">{t("longTimerHint", { hours: LONG_TIMER_HOURS })}</p>
      </div>
      <Switch checked={checked} onChange={() => toggle(!checked)} label={t("longTimerTitle")} />
    </div>
  );
}
