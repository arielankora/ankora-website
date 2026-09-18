#!/usr/bin/env python3
"""
Phase 10 follow-up: Holiday calendar subscription UI (client-detail screen).
Run from the repo root (arielankora/ankora-website).
Idempotent: safe to re-run - each patch checks it applies exactly once,
and re-running after it already applied will fail loudly (old string no
longer found) rather than double-applying.
"""
import pathlib

ROOT = pathlib.Path(".")

def patch_file(path, replacements):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(
                f"ABORT: expected exactly 1 occurrence of anchor text in {path}, found {count}.\n"
                f"Anchor (first 120 chars): {old[:120]!r}\n"
                f"No changes were written to this file."
            )
        text = text.replace(old, new)
    p.write_text(text, encoding="utf-8")
    print(f"Patched: {path}")


# ---------------------------------------------------------------------------
# 1. New file: HolidayCalendarsPanel.tsx (client component)
# ---------------------------------------------------------------------------
NEW_PANEL_PATH = ROOT / "app/(product)/app/(authenticated)/clients/HolidayCalendarsPanel.tsx"
NEW_PANEL_CONTENT = '''"use client";
import { useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();
  const subscribedByKey = new Map(subscriptions.map((s) => [s.calendarKey, s.enabled]));

  return (
    <ul className="mt-3 space-y-2">
      {calendars.map((cal) => {
        const enabled = subscribedByKey.get(cal.calendarKey) ?? false;
        return (
          <li key={cal.calendarKey} className="flex items-center justify-between gap-3 text-sm">
            <div>
              <span className="text-navy">{cal.label}</span>
              <span className="ms-2 text-xs text-navy/40">({cal.holidayCount} מועדים)</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge label={enabled ? "רשום" : "לא רשום"} tone={enabled ? "green" : "gray"} />
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => toggleHolidayCalendarSubscriptionAction(clientId, cal.calendarKey, !enabled))
                }
                className="text-xs font-medium text-navy/70 underline decoration-navy/30 underline-offset-2 disabled:opacity-50"
              >
                {enabled ? "ביטול רישום" : "רישום"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
'''

if NEW_PANEL_PATH.exists() and NEW_PANEL_PATH.read_text(encoding="utf-8") == NEW_PANEL_CONTENT:
    print(f"Already up to date: {NEW_PANEL_PATH}")
else:
    NEW_PANEL_PATH.write_text(NEW_PANEL_CONTENT, encoding="utf-8")
    print(f"Created: {NEW_PANEL_PATH}")


# ---------------------------------------------------------------------------
# 2. important-dates/actions.ts - import + new server action
# ---------------------------------------------------------------------------
patch_file(
    "app/(product)/app/(authenticated)/important-dates/actions.ts",
    [
        (
            '''import {
  createImportantDate,
  updateImportantDate,
  updateImportantDateStatus,
  snoozeImportantDate,
  deleteImportantDate,
  ConflictError,
} from "@/lib/app-domain/important-dates";''',
            '''import {
  createImportantDate,
  updateImportantDate,
  updateImportantDateStatus,
  snoozeImportantDate,
  deleteImportantDate,
  setHolidayCalendarSubscription,
  ConflictError,
} from "@/lib/app-domain/important-dates";''',
        ),
        (
            '''export async function deleteImportantDateAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("importantDateId") || "");
  if (!id) return;

  await deleteImportantDate(user, id);
  revalidatePath("/app/important-dates");
  redirect("/app/important-dates");
}''',
            '''export async function deleteImportantDateAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("importantDateId") || "");
  if (!id) return;

  await deleteImportantDate(user, id);
  revalidatePath("/app/important-dates");
  redirect("/app/important-dates");
}

// Phase 10 follow-up: holiday-calendar subscription toggle, called
// directly from HolidayCalendarsPanel.tsx (client component), same
// pattern as alerts/RuleActions.tsx -> toggleAlertRuleAction (positional
// args, no FormData). setHolidayCalendarSubscription() itself enforces
// important_date.manage_catalog (SUPER_ADMIN-only) and client access.
export async function toggleHolidayCalendarSubscriptionAction(
  clientId: string,
  calendarKey: string,
  enabled: boolean
): Promise<void> {
  const user = await requireUser();
  await setHolidayCalendarSubscription(user, clientId, calendarKey, { enabled });
  revalidatePath(`/app/clients/${clientId}`);
  revalidatePath("/app/important-dates");
}''',
        ),
    ],
)


# ---------------------------------------------------------------------------
# 3. clients/[clientId]/page.tsx - imports, data fetch, new UI section
# ---------------------------------------------------------------------------
patch_file(
    "app/(product)/app/(authenticated)/clients/[clientId]/page.tsx",
    [
        (
            'import { listImportantDates, IMPORTANT_DATE_STATUS_LABELS } from "@/lib/app-domain/important-dates";',
            '''import {
  listImportantDates,
  IMPORTANT_DATE_STATUS_LABELS,
  listHolidayCalendars,
  listHolidaySubscriptionsForClient,
} from "@/lib/app-domain/important-dates";''',
        ),
        (
            'import { EditClientForm } from "./EditClientForm";',
            '''import { EditClientForm } from "./EditClientForm";
import { HolidayCalendarsPanel } from "./HolidayCalendarsPanel";''',
        ),
        (
            '''  const clientDates = await listImportantDates(user, { clientId: client.id });

  return (
    <>''',
            '''  const clientDates = await listImportantDates(user, { clientId: client.id });

  // Phase 10 follow-up ("לוחות חגים" UI gap - ADR 21.6): gate matches
  // setHolidayCalendarSubscription()'s own important_date.manage_catalog
  // check, so the section (and its data fetch) simply doesn't render for
  // anyone else, rather than rendering then failing on first click.
  const canManageHolidayCalendars = can(user.role, "important_date.manage_catalog");
  const holidayCalendars = canManageHolidayCalendars ? listHolidayCalendars() : [];
  const holidaySubscriptions = canManageHolidayCalendars
    ? await listHolidaySubscriptionsForClient(user, client.id)
    : [];

  return (
    <>''',
        ),
        (
            '''        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">משתמשים מוקצים ({client.employeeAccess.length})</h2>''',
            '''        </div>

        {canManageHolidayCalendars && (
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-navy">לוחות חגים</h2>
              <span className="text-xs text-navy/40">תזכורות ברירת מחדל: 30 ו-7 ימים לפני</span>
            </div>
            <p className="mt-1 text-xs text-navy/50">
              רישום הלקוח ללוח חג יוצר אוטומטית מועד חשוב לכל חג בלוח, ומתעדכן מדי שנה.
            </p>
            <HolidayCalendarsPanel clientId={client.id} calendars={holidayCalendars} subscriptions={holidaySubscriptions} />
          </div>
        )}

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">משתמשים מוקצים ({client.employeeAccess.length})</h2>''',
        ),
    ],
)


# ---------------------------------------------------------------------------
# 4. guide/content.ts - update note + add step, now that the UI exists
# ---------------------------------------------------------------------------
patch_file(
    "app/(product)/app/(authenticated)/guide/content.ts",
    [
        (
            '''          "לסינון: בחרו לקוח, קטגוריה ו/או סטטוס ולחצו \\"סינון\\".",
        ],
        notes: [
          "חגי ישראל (ראש השנה, יום כיפור, פסח, ועוד) ניתנים כקטלוג מוכן לכל לקוח - אך אף לקוח לא נרשם אליו אוטומטית; ההרשמה (Subscribe) לקטלוג חגים היא פעולת מנהל-על בלבד, לפי בחירה מפורשת לכל לקוח.",''',
            '''          "לסינון: בחרו לקוח, קטגוריה ו/או סטטוס ולחצו \\"סינון\\".",
          "להרשמת לקוח ללוח חגים: בדף פרטי הלקוח (מסך לקוחות), בסעיף \\"לוחות חגים\\", לחצו \\"רישום\\" ליד לוח החג הרצוי - זמין למנהל-על בלבד.",
        ],
        notes: [
          "ארבעה קטלוגים של חגים מוכנים מראש (ישראל, בינלאומי, ארה\\"ב, בריטניה) - אך אף לקוח לא נרשם אליהם אוטומטית. הרשמה/ביטול הרשמה מתבצעת בדף פרטי הלקוח, בסעיף \\"לוחות חגים\\" - פעולת מנהל-על בלבד. הרשמה יוצרת אוטומטית מועד חשוב לכל חג בלוח (למשל חגי ישראל, או Valentine's Day מהקטלוג הבינלאומי), עם תזכורות ברירת מחדל של 30 ו-7 ימים לפני.",''',
        ),
    ],
)

print("\nAll patches applied successfully.")
print("Next: review the diff (git diff), then:")
print('  git checkout -b feature/important-dates-holiday-subscriptions')
print('  git add -A')
print('  git commit -m "feat: holiday calendar subscription UI on client-detail screen"')
print('  git push -u origin feature/important-dates-holiday-subscriptions')
