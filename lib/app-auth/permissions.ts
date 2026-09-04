// RBAC for Phase 1 scope only: user.manage, client.manage, category.manage,
// audit.view. Spec section 4.1 describes a fuller granular permission list
// (time_entry.*, hour_bank.manage, report.*...) that only makes sense once
// those entities exist (Phase 2+) - adding permission strings for
// non-existent resources now would be dead code, so they're deliberately
// left out until the phase that needs them.
//
// Every server-side entry point (route handler / server action) must call
// one of these - never rely on hiding a button in the UI (spec 4.1: "אין
// להסתמך על הסתרת כפתור ב-UI").
import type { UserRole } from "@prisma/client";

export type Permission = "user.manage" | "client.manage" | "category.manage" | "audit.view";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: ["user.manage", "client.manage", "category.manage", "audit.view"],
  // Spec 4: Ankora Admin/Manager gets clients/categories, but not
  // "critical system actions" (user management, audit) unless explicitly
  // granted - no such grant mechanism exists yet in Phase 1, so this is
  // the conservative default.
  ANKORA_ADMIN: ["client.manage", "category.manage"],
  ANKORA_EMPLOYEE: [],
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
