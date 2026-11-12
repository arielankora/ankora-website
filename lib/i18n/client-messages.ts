// ADR 0006: the part of the dictionary the browser gets.
//
// NextIntlClientProvider serialises the messages it is given into every
// page and into every server action's response that re-renders the
// layout. The whole dictionary would grow with every translated screen
// (hundreds of kilobytes once the app is translated) while most of it is
// read only on the server: domain errors, server-rendered pages, the
// guide. So the provider gets only the namespaces a component reads with
// the `useTranslations` hook, which is the only way a component that may
// run in the browser reads the dictionary.
//
// tests/unit/i18n-client-messages.test.ts keeps this list honest: every
// namespace passed to the useTranslations hook must be covered by an entry, and every
// entry must still be used. Adding a translated client component with a
// new namespace fails that test until the namespace is listed here.
export const CLIENT_MESSAGE_PATHS = [
  "alerts.form",
  "alerts.panel",
  "alerts.picker",
  "alerts.retry",
  "alerts.rule",
  "auth",
  "categories.create",
  "categories.edit",
  "claude",
  "credentials",
  "extractionGuide",
  "hourBanks.adjustment",
  "hourBanks.cycleForm",
  "hourBanks.loadForm",
  "hourBanks.picker",
  "hourBanks.policy",
  "integrations.advance",
  "messageClient",
  "myTime.closedBank",
  "myTime.entry",
  "myTime.form",
  "myTime.overlap",
  "profile",
  "reportSchedules",
  "reports.filters",
  "reports.summary",
  "reports.values",
  "shell",
  "tasks.board",
  "tasks.common",
  "tasks.create",
  "tasks.detail",
  "tasks.filters",
  "tasks.list",
  "tasks.row",
  "timeEntriesAdmin.create",
  "timeEntriesAdmin.filters",
  "timeEntriesAdmin.row",
  "timeEntriesAdmin.table",
  "timer",
  "users.clientAccess",
  "users.deletionDeclaration",
  "users.exceptionApprover",
  "users.exposure",
  "users.invite",
  "users.pendingPdf",
  "users.personalEmail",
  "users.resendInvite",
  "users.roleStatus",
] as const;

type Tree = { [key: string]: string | Tree };

/// A copy of `messages` with only the given dotted paths. A path that does
/// not exist is skipped rather than invented.
export function pickMessages<T extends object>(messages: T, paths: readonly string[] = CLIENT_MESSAGE_PATHS): Partial<T> {
  const out: Tree = {};
  for (const path of paths) {
    const parts = path.split(".");
    let src: string | Tree | undefined = messages as unknown as Tree;
    for (const part of parts) src = typeof src === "object" && src ? src[part] : undefined;
    if (src === undefined) continue;
    let dst = out;
    for (const part of parts.slice(0, -1)) dst = (dst[part] ??= {}) as Tree;
    dst[parts[parts.length - 1]] = src;
  }
  return out as Partial<T>;
}
