import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";

export const metadata = { robots: { index: false, follow: false } };

const PAGE_SIZE = 50;
const ENTITY_TYPES = [
  "User",
  "Client",
  "Category",
  "TimeEntry",
  "BillingPolicy",
  "HourBank",
  "HourBankAdjustment",
  "AlertRule",
  "AlertEvent",
  "EmailDelivery",
  "ReportSchedule",
];

const ACTION_LABEL: Record<string, string> = {
  "login.success": "התחברות מוצלחת",
  "login.failure": "ניסיון התחברות כושל",
  "password_reset.requested": "בקשת איפוס סיסמה",
  "password_reset.completed": "איפוס סיסמה הושלם",
  "user.invite": "הזמנת משתמש",
  "user.role_status_change": "שינוי תפקיד/סטטוס",
  "user.client_access_change": "שינוי גישה ללקוחות",
  "user.logout_all_sessions": "ניתוק כל ההתחברויות",
  "client.create": "יצירת לקוח",
  "client.settings_change": "עדכון הגדרות לקוח",
  "client.archive": "העברת לקוח לארכיון",
  "category.create": "יצירת קטגוריה",
  "category.update": "עדכון קטגוריה",
  "category.archive": "העברת קטגוריה לארכיון",
  // Phase 2 (spec 16.1: "Create/Edit/Delete TimeEntry") - covers both
  // timer start/stop and manual entries; the entry's own source/before-
  // after JSON (visible via the entry detail) distinguishes which.
  "time_entry.create": "יצירת דיווח זמן",
  "time_entry.update": "עדכון דיווח זמן",
  "time_entry.delete": "מחיקת דיווח זמן",
  "time_entry.restore": "שחזור דיווח זמן",
  // Phase 3 (spec 8: בנק שעות + מדיניות חיוב).
  "billing_policy.create": "יצירת מדיניות חיוב",
  "billing_policy.update": "עדכון מדיניות חיוב",
  "hour_bank.open_cycle": "פתיחת מחזור בנק שעות",
  "hour_bank.adjustment.create": "התאמה ידנית לבנק שעות",
  // Phase 4 (spec 9/16.1: "Alert rule change").
  "alert_rule.create": "יצירת כלל התראה",
  "alert_rule.update": "עדכון כלל התראה",
  "alert_rule.delete": "מחיקת כלל התראה",
  "email_delivery.retry": "ניסיון שליחה חוזר להתראה",
  "alert_event.resolve": "סימון התראה כטופלה",
  "alert_event.reopen": "פתיחה מחדש של התראה",
  "report_schedule.create": "יצירת דוח מתוזמן",
  "report_schedule.update": "עדכון דוח מתוזמן",
  "report_schedule.delete": "מחיקת דוח מתוזמן",
  "report_schedule.sent": "שליחת דוח מתוזמן",
  // Phase 9 gap-fix (spec §11): Tasks/Profile self-service actions.
  "task.create": "יצירת משימה",
  "task.status_change": "שינוי סטטוס משימה",
  "profile.password_change": "החלפת סיסמה עצמית",
  "profile.timezone_update": "עדכון אזור זמן",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

// App redesign (handoff README, screen 14 "יומן פעולות"): "שורה: תג סוג
// (יצירה/עריכה/מחיקה/הרשאות/התחברות/כשלון)" - derives one of those six
// kinds from the action string's own naming convention (verified against
// every action key in ACTION_LABEL above) rather than adding a parallel
// "kind" column to the schema.
function classifyAction(action: string): { label: string; tone: "green" | "amber" | "gray" | "red" } {
  if (action.includes("failure")) return { label: "כשלון", tone: "red" };
  if (action.startsWith("login.") || action === "logout" || action.includes("logout_all_sessions"))
    return { label: "התחברות", tone: "gray" };
  if (action.includes("role_status_change") || action.includes("client_access_change") || action.includes("invite"))
    return { label: "הרשאות", tone: "amber" };
  if (action.includes(".delete") || action.includes(".archive")) return { label: "מחיקה", tone: "red" };
  if (action.includes(".create") || action.includes(".requested")) return { label: "יצירה", tone: "green" };
  return { label: "עריכה", tone: "amber" };
}

export default async function AuditLogPage(
  props: {
    searchParams: Promise<{ entityType?: string; q?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  if (!can(user.role, "audit.view")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const entityType = searchParams.entityType && ENTITY_TYPES.includes(searchParams.entityType) ? searchParams.entityType : undefined;
  const q = searchParams.q?.trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where = {
    ...(entityType ? { entityType } : {}),
    ...(q ? { action: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: { actor: true, client: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">יומן פעולות</h1>
          <p className="mt-1 text-sm text-navy/60">רשומה בלתי ניתנת לעריכה של כל הפעולות הרגישות במערכת.</p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-4 rounded-2xl border border-lineDark bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-navy/60">סוג ישות</label>
            <select
              name="entityType"
              defaultValue={entityType ?? ""}
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">הכל</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">חיפוש פעולה</label>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="למשל login.failure"
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
          <button type="submit" className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy/70 hover:border-gold">
            סינון
          </button>
          <a
            href={`/api/audit-log/export${entityType || q ? `?${new URLSearchParams({ ...(entityType ? { entityType } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`}
            className="ms-auto rounded-full border border-lineDark px-4 py-2 text-sm text-navy/70 transition-colors hover:border-gold"
          >
            ייצוא
          </a>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[820px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">סוג</th>
                <th className="px-5 py-3 font-medium">פעולה</th>
                <th className="px-5 py-3 font-medium">בוצע ע&quot;י</th>
                <th className="px-5 py-3 font-medium">לקוח</th>
                <th className="px-5 py-3 font-medium">מועד</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-navy/50">
                    לא נמצאו רשומות התואמות לסינון.
                  </td>
                </tr>
              )}
              {events.map((event) => {
                const kind = classifyAction(event.action);
                return (
                  <tr key={event.id} className="border-b border-lineDark last:border-0 align-top">
                    <td className="whitespace-nowrap px-5 py-3">
                      <StatusBadge label={kind.label} tone={kind.tone} />
                    </td>
                    <td className="px-5 py-3 text-navy">
                      {ACTION_LABEL[event.action] ?? event.action}
                      <p className="mt-0.5 text-xs text-navy/40">
                        {event.entityType}
                        {event.entityId && ` #${event.entityId.slice(-6)}`}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-navy/70">{event.actor?.name ?? "מערכת"}</td>
                    <td className="px-5 py-3 text-navy/70">{event.client?.name ?? "-"}</td>
                    <td dir="ltr" className="whitespace-nowrap px-5 py-3 text-end font-jbmono text-xs text-navy/50">
                      {formatDateTime(event.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 text-sm text-navy/60">
            {page > 1 && (
              <Link
                href={{ pathname: "/app/audit-log", query: { entityType, q, page: page - 1 } }}
                className="rounded-full border border-lineDark px-3 py-1.5 hover:border-gold"
              >
                הקודם
              </Link>
            )}
            <span>
              עמוד {page} מתוך {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={{ pathname: "/app/audit-log", query: { entityType, q, page: page + 1 } }}
                className="rounded-full border border-lineDark px-3 py-1.5 hover:border-gold"
              >
                הבא
              </Link>
            )}
          </div>
        )}

        <p className="text-xs text-navy/50">היומן נשמר לשנתיים ואינו ניתן לעריכה או למחיקה.</p>
      </div>
    </>
  );
}
