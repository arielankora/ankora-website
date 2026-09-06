# Roles & permissions matrix

Generated directly from `ROLE_PERMISSIONS` in `lib/app-auth/permissions.ts`
for spec §26's "פירוט roles/permissions" deliverable. This is a
quick-reference table only — the *why* behind each grant or withholding
decision (e.g. why `report.internal.view` goes to `ANKORA_ADMIN` but
`hour_bank.manage` does not) lives in `lib/app-auth/permissions.ts`'s own
inline comments and in `docs/adr/0001-time-tracking-app-architecture.md`'s
per-phase addenda — read this table alongside those, not instead of them.
If this table and `permissions.ts` ever disagree, `permissions.ts` is the
source of truth; this file should be regenerated, not hand-edited around a
drift.

Every server-side mutation calls `assertCan(role, permission)` — nothing is
enforced by hiding a UI element alone (spec §4.1: "אין להסתמך על הסתרת כפתור
ב-UI").

## Matrix

| Permission | Introduced | SUPER_ADMIN | ANKORA_ADMIN | ANKORA_EMPLOYEE | CLIENT_USER |
| --- | --- | :---: | :---: | :---: | :---: |
| `user.manage` | Phase 1 | ✅ | — | — | — |
| `client.manage` | Phase 1 | ✅ | ✅ | — | — |
| `category.manage` | Phase 1 | ✅ | ✅ | — | — |
| `audit.view` | Phase 1 | ✅ | — | — | — |
| `time_entry.create_self` | Phase 2 | ✅ | ✅ | ✅ | — |
| `time_entry.edit_self` | Phase 2 | ✅ | ✅ | ✅ | — |
| `time_entry.edit_others` | Phase 2 | ✅ | ✅ | — | — |
| `hour_bank.manage` | Phase 3 | ✅ | — | — | — |
| `alert.manage` | Phase 4 | ✅ | — | — | — |
| `report.internal.view` | Phase 5 | ✅ | ✅ | — | — |
| `report.client.view` | Phase 6 | — | — | — | ✅ |
| `integration.manage` | Phase 8 | ✅ | — | — | — |

## Per-role summary

- **SUPER_ADMIN** — every permission that exists. The only role that can
  manage users, view the audit log, manage hour banks, manage alerts, or
  manage integrations.
- **ANKORA_ADMIN** — clients, categories, and time entries (including
  editing other employees' entries) and internal reports. Deliberately
  *not* granted `user.manage`, `audit.view`, `hour_bank.manage`,
  `alert.manage`, or `integration.manage` — spec §4's role table names
  these as Super-Admin-only "critical system actions," with no grant
  mechanism defined for extending them to Ankora Admin/Manager.
- **ANKORA_EMPLOYEE** — only their own timer and time entries
  (`create_self` + `edit_self`); never `edit_others`, never any report or
  admin permission. Spec §4: "טיימר ודיווחים שלו; עריכה עצמית לפי window
  מוגדר."
- **CLIENT_USER** — only `report.client.view`, which gates every Client
  Portal screen and export. No `time_entry.*` permission at all (spec
  §4.1: "לקוח לעולם לא מקבל הרשאת edit על Time Entries של Ankora ב-MVP")
  and never `report.internal.view` (a client must never see Actual time,
  other clients' data, or internal notes — spec §13's exclusion list). The
  `ClientUserRole` (`ADMIN` vs `VIEWER`, spec §4) is a separate,
  client-scoped distinction that only affects the narrower
  recipients-editing capability inside the portal itself — it does not
  change which top-level `Permission` a `CLIENT_USER` holds.

## Roles not modeled as a `Permission` grant

`UserClientAccess` (which clients a specific `ANKORA_EMPLOYEE` may work
with) and `ClientUser` (which client a specific `CLIENT_USER` belongs to,
plus their `ClientUserRole`) are data-scoping relations, not entries in
`ROLE_PERMISSIONS` — an employee can hold `time_entry.create_self` and
still be blocked from a specific client if no `UserClientAccess` row grants
it (spec §4.1: "אסור לעובד לדווח זמן ללקוח שאינו משויך אליו"), enforced by
`canManageClients()` and the domain-layer client-scoping checks alongside
(not instead of) the permission check.
