"use client";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toggleHolidayCalendarSubscriptionAction } from "../important-dates/actions";
import { StatusBadge } from "@/components/app/StatusBadge";

type Calendar = { calendarKey: string; label: string; holidayCount: number };
type Subscription = { calendarKey: string; enabled: boolean };

// Phase 10 follow-up ("לוחות חגים" UI gap - see ADR section 21.6): minimal
// enable/disable toggle per calendar, reusing RuleActions.tsx's exact
// pattern (client component calling a server action directly via
// useTransition - no form needed, no FormData). Deliberately does not
// expose per-calendar lead-days/responsible-user/auto-task customization
// in this round - setHolidayCalendarSubscription()'s own defaults
// (30/7-day reminders, no auto-task) apply on first subscribe; a
// follow-up round can add that UI later. Disclosed scope reduction, same
// pattern as ADR 21.10's calendar-view decision.
export function HolidayCalendarsPanel({
  clientId,
  calendars,
  subscriptions,
}: {
  clientId: string;
  calendars: Calendar[];
  subscriptions: Subscription[];
}) {
  const t = useTranslations("clients.holidays");
  const [isPending, startTransition] = useTransition();
  const subscribedByKey = new Map(subscriptions.map((s) => [s.calendarKey, s.enabled]));

  return (
    <ul className="mt-3 space-y-2">
      {calendars.map((cal) => {
        const enabled = subscribedByKey.get(cal.calendarKey) ?? false;
        return (
          <li key={cal.calendarKey} className="flex items-center justify-between gap-3 text-sm">
            <div>
              <span className="text-app-text-primary">{cal.label}</span>
              <span className="ms-2 text-xs text-app-text-tertiary">{t("count", { count: cal.holidayCount })}</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge label={enabled ? t("subscribed") : t("notSubscribed")} tone={enabled ? "green" : "gray"} />
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => toggleHolidayCalendarSubscriptionAction(clientId, cal.calendarKey, !enabled))
                }
                className="text-xs font-medium text-app-text-secondary underline decoration-app-border-strong underline-offset-2 disabled:opacity-50"
              >
                {enabled ? t("unsubscribe") : t("subscribe")}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
