// The audit screen's two registries, lifted out of page.tsx so they can be
// tested.
//
// They are a second place every audited action has to be written down, and
// nothing in the type system connects them to `recordAudit`. An action that
// is missing here still records perfectly; it just renders in the Hebrew
// audit log as a raw English string like `mcp.oauth.granted`, and its
// entity type is missing from the filter, so nobody can select it.
//
// That is exactly what had happened: a live run of the screen in September
// 2026 turned up fifteen actions and five entity types with no entry, some
// dating back to Phase 10. tests/unit/audit-labels.test.ts now scans every
// `recordAudit` call site in the source and fails if one is unregistered
// here, so the next omission is caught before it ships instead of a year
// later by accident.

export const ENTITY_TYPES = [
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
  "Task",
  "ImportantDate",
  "ReminderRule",
  "HolidayCalendarSubscription",
  // The nightly export records itself against a "System" entity - no row
  // in any table is its subject, the run is.
  "System",
  // Both halves of a Claude grant's life: "OAuthClient" is what consent
  // records when access is given, "McpGrant" what revoking records when
  // it is taken away. Neither was filterable before - the granted rows
  // had been landing in this table since Phase 15 with no way to select
  // them and no Hebrew label, which a live run of the audit screen is
  // how we noticed.
  "OAuthClient",
  "McpGrant",
];

export const ACTION_LABEL: Record<string, string> = {
  "login.success": "התחברות מוצלחת",
  "login.failure": "ניסיון התחברות כושל",
  "password_reset.requested": "בקשת איפוס סיסמה",
  "password_reset.completed": "איפוס סיסמה הושלם",
  // Portal phase 0.
  "login_link.requested": "בקשת קישור כניסה לפורטל",
  "login_link.success": "כניסה לפורטל בקישור",
  "portal.preview.start": "כניסה לתצוגת לקוח",
  "user.invite": "הזמנת משתמש",
  "user.invite.resent": "שליחת הזמנה מחדש",
  "user.role_status_change": "שינוי תפקיד/סטטוס",
  "user.client_access_change": "שינוי גישה ללקוחות",
  "user.logout_all_sessions": "ניתוק כל ההתחברויות",
  "client.create": "יצירת לקוח",
  "client.settings_change": "עדכון הגדרות לקוח",
  "client.archive": "העברת לקוח לארכיון",
  "client.restore": "שחזור לקוח מהארכיון",
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
  // Claude (MCP) grants, both directions: the consent endpoint has
  // recorded "granted" since Phase 15, revoking is new in Phase 4.
  "mcp.oauth.granted": "אישור חיבור Claude",
  "mcp_grant.revoke": "ניתוק חיבור Claude",
  "mcp_grant.revoke_all": "ניתוק כל חיבורי Claude של משתמש",
  "profile.timezone_update": "עדכון אזור זמן",
  "task.update": "עדכון משימה",
  "task.auto_create_from_important_date": "יצירת משימה אוטומטית ממועד חשוב",
  "profile.name_update": "עדכון שם תצוגה",
  "profile.notification_preference_update": "עדכון העדפת התראות",
  // Phase 10 (מועדים חשובים) and its reminder rules - audited since they
  // shipped, unlabelled until this pass.
  "important_date.create": "יצירת מועד חשוב",
  "important_date.update": "עדכון מועד חשוב",
  "important_date.status_change": "שינוי סטטוס מועד חשוב",
  "important_date.snooze": "דחיית מועד חשוב",
  "important_date.delete": "מחיקת מועד חשוב",
  "important_date.auto_create_holiday": "יצירת מועד אוטומטית מלוח חגים",
  "holiday_calendar_subscription.update": "עדכון מנוי ללוח חגים",
  "reminder_rule.create": "יצירת כלל תזכורת",
  "reminder_rule.delete": "מחיקת כלל תזכורת",
  // Phase 11: the nightly data export, recorded so a missing backup is
  // visible here and not only in a mailbox.
  "backup.nightly_export.sent": "שליחת גיבוי יומי",
};

// App redesign (handoff README, screen 14 "יומן פעולות"): "שורה: תג סוג
// (יצירה/עריכה/מחיקה/הרשאות/התחברות/כשלון)" - derives one of those six
// kinds from the action string's own naming convention (verified against
// every action key in ACTION_LABEL above) rather than adding a parallel
// "kind" column to the schema.
export function classifyAction(action: string): { label: string; tone: "green" | "amber" | "gray" | "red" } {
  if (action.includes("failure")) return { label: "כשלון", tone: "red" };
  if (action.startsWith("login.") || action === "logout" || action.includes("logout_all_sessions"))
    return { label: "התחברות", tone: "gray" };
  if (
    action.includes("role_status_change") ||
    action.includes("client_access_change") ||
    action.includes("invite") ||
    // Giving or revoking a credential is an access change, not an edit -
    // without this both would fall through to the generic "עריכה" tag
    // and read as routine on a screen an admin scans for exactly these
    // events.
    action.includes(".revoke") ||
    action.includes(".granted")
  )
    return { label: "הרשאות", tone: "amber" };
  if (action.includes(".delete") || action.includes(".archive")) return { label: "מחיקה", tone: "red" };
  if (action.includes(".create") || action.includes(".requested")) return { label: "יצירה", tone: "green" };
  return { label: "עריכה", tone: "amber" };
}
