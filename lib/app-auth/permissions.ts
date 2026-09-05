// RBAC. Phase 1 added user.manage, client.manage, category.manage,
// audit.view. Phase 2 (spec 23: "Timer + TimeEntry + manual entry + audit
// revisions") added the time_entry.* permissions spec 4.1 names explicitly
// as its example granular list: time_entry.create_self, time_entry.edit_self,
// time_entry.edit_others. Phase 3 (spec 23: "Billing policy + hour bank +
// live client snapshot") adds hour_bank.manage - spec 4.1's own example
// list names this permission too, covering BillingPolicy configuration,
// HourBank cycle creation/rollover, and manual adjustments as one
// permission (the spec never splits billing-policy-edit from
// hour-bank-edit into two separate permissions).
//
// Phase 4 (spec 23: "Alerts + email delivery logs") adds alert.manage -
// not named in spec 4.1's own example list (that list predates Phase 4),
// but spec 12 places "Alerts" as an admin screen alongside "Hour Banks",
// gating on thresholds defined against the same per-client hour-bank
// data hour_bank.manage already protects. Same SUPER_ADMIN-only default
// as hour_bank.manage, for the identical reason documented on that
// permission below.
//
// Phase 5 (spec 23: "Internal dashboards + reports + exports") adds
// report.internal.view - this one IS named in spec 4.1's own example
// list ("report.internal.view, report.client.view"), and unlike
// hour_bank.manage/alert.manage, spec section 4's role table explicitly
// grants it to Ankora Admin/Manager: their row reads "לקוחות/קטגוריות/
// דוחות/עריכות לפי הרשאה" - clients/categories/REPORTS/edits - so
// report.internal.view is SUPER_ADMIN + ANKORA_ADMIN, not Super-Admin-only
// like the two Phase 4/3 examples above. report.client.view (client-facing
// reports, spec section 13's Client Portal) remains out of scope until
// Phase 6 models that screen.
//
// Every server-side entry point (route handler / server action) must call
// one of these - never rely on hiding a button in the UI (spec 4.1: "אין
// להסתמך על הסתרת כפתור ב-UI").
import type { UserRole } from "@prisma/client";

export type Permission =
  | "user.manage"
  | "client.manage"
  | "category.manage"
  | "audit.view"
  // Phase 2 - spec 4.1's own example list, used verbatim. create_self also
  // covers starting/stopping a timer (a timer is just a TimeEntry with
  // endAt initially null) - there is no separate "timer.use" permission
  // because the spec never introduces one.
  | "time_entry.create_self"
  | "time_entry.edit_self"
  | "time_entry.edit_others"
  // Phase 3 - spec 4.1's own example list, used verbatim.
  | "hour_bank.manage"
  // Phase 4 - not in spec 4.1's own list (see comment above); named
  // alert.manage for consistency with hour_bank.manage's naming style.
  | "alert.manage"
  // Phase 5 - spec 4.1's own example list, used verbatim.
  | "report.internal.view";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  // Spec 4 role table: Super Admin - "הכול: משתמשים, לקוחות, בנקים,
  // הרשאות, עריכות, audit, דוחות" - includes editing anyone's time entries
  // and all reports.
  SUPER_ADMIN: [
    "user.manage",
    "client.manage",
    "category.manage",
    "audit.view",
    "time_entry.create_self",
    "time_entry.edit_self",
    "time_entry.edit_others",
    "hour_bank.manage",
    "alert.manage",
    "report.internal.view",
  ],
  // Spec 4: Ankora Admin/Manager gets clients/categories/edits, but not
  // "critical system actions" (user management, audit) unless explicitly
  // granted - no such grant mechanism exists yet, so this remains the
  // same conservative Phase 1 default (audit.view stays Super-Admin-only).
  // Row's "עריכות" (edits) capability maps to spec 4.1's
  // time_entry.edit_others. Row's "דוחות" (reports) capability maps to
  // spec 4.1's report.internal.view - unlike hour_bank.manage/alert.manage,
  // this one IS named for Ankora Admin/Manager explicitly, so it is
  // granted here (see Phase 5 comment above the Permission union).
  ANKORA_ADMIN: [
    "client.manage",
    "category.manage",
    "time_entry.create_self",
    "time_entry.edit_self",
    "time_entry.edit_others",
    "report.internal.view",
    // Spec 4's role table lists "משתמשים, לקוחות, בנקים, הרשאות, עריכות,
    // audit, דוחות" (users, clients, BANKS, permissions, edits, audit,
    // reports) under Super Admin explicitly, but Ankora Admin/Manager's
    // own row only says "לקוחות/קטגוריות/דוחות/עריכות לפי הרשאה" - clients/
    // categories/reports/edits - and does NOT mention hour banks. Same
    // conservative precedent as Phase 2's audit.view decision (see that
    // decision's comment above, and the regression test in
    // tests/unit/permissions.test.ts guarding it): when a capability is
    // named for Super Admin but silently absent from Admin/Manager's own
    // row, treat that as deliberate rather than an oversight. hour_bank.
    // manage therefore stays Super-Admin-only until Ariel says otherwise.
  ],
  // Spec 4: "טיימר ודיווחים שלו; צפייה בהיסטוריה שלו; עריכה עצמית לפי
  // window מוגדר" - own timer/entries only, no edit_others, no reports.
  ANKORA_EMPLOYEE: ["time_entry.create_self", "time_entry.edit_self"],
  // Spec 4.1: "לקוח לעולם לא מקבל הרשאת edit על Time Entries של Ankora
  // ב-MVP" - Client Admin/Viewer are both read-only on time entries, so
  // CLIENT_USER (which models both) gets none of the time_entry.*
  // permissions. report.internal.view is Ankora-internal by name/scope -
  // client-facing reporting is the separate report.client.view permission,
  // out of scope until Phase 6's Client Portal.
  CLIENT_USER: [],
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function assertCan(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(`Role ${role} lacks permission ${permission}`);
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/// Whether an Ankora employee may access a given client's data - either
/// because they hold a management permission (admins see everything) or
/// because they're explicitly assigned via UserClientAccess. Spec 4.1:
/// "אסור לעובד לדווח זמן ללקוח שאינו משויך אליו."
export function canManageClients(role: UserRole): boolean {
  return can(role, "client.manage");
}
