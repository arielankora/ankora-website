// The navigation's groups (ADR 0006), in a plain module on purpose.
//
// AppShell is a server component and Sidebar a client one. A value the
// server imports from a "use client" file is not the value: it is a
// reference to client code, and comparing or printing it on the server
// gives a function, not "account". Everything both sides need lives here.

/// Groups are ids. The label beside each is what a person reads, in their
/// language; the id is what the code decides by.
export type NavGroupId = "work" | "clients" | "control" | "settings" | "account";

export type NavItem = { href: string; label: string; group?: NavGroupId; groupLabel?: string };

/// Items in this group live in the menu under the person's name, not in the
/// list (19.10.2026). BottomNav and the command palette still list them.
export const ACCOUNT_GROUP: NavGroupId = "account";
