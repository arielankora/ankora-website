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
  "auth",
  "claude",
  "clients.connections",
  "clients.control",
  "clients.create",
  "clients.decisions",
  "clients.entities",
  "clients.extract",
  "clients.facts",
  "clients.file.documentKinds",
  "clients.file.documents",
  "clients.file.parts",
  "clients.file.summary",
  "clients.holidays",
  "clients.knowledge",
  "clients.list.grid",
  "clients.list.restore",
  "clients.narratives",
  "clients.page.edit",
  "clients.page.knowledgeStatus",
  "clients.people",
  "clients.policies",
  "clients.processes",
  "clients.questions",
  "clients.requestTypes",
  "clients.sources",
  "clients.subprocessors",
  "clients.systems",
  "clients.tasks",
  "guide",
  "messageClient",
  "myTime.closedBank",
  "myTime.entry",
  "myTime.form",
  "myTime.overlap",
  "profile",
  "shell",
  "tasks.board",
  "tasks.common",
  "tasks.create",
  "tasks.detail",
  "tasks.filters",
  "tasks.list",
  "tasks.row",
  "timer",
  "vault.reveal",
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
