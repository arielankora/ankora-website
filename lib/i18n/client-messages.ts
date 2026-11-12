// ADR 0006: the part of the dictionary the browser gets.
//
// NextIntlClientProvider serialises the messages it is given into every
// page and into every server action response that re-renders the layout.
// Only the namespaces a component reads with the `useTranslations` hook are
// sent, and only for the area of the app the page is in: the lists are in
// lib/i18n/route-messages.generated.ts, worked out from the code by
// scripts/i18n/route-messages.mjs. The root layout sends the global part;
// each area's layout adds its own (components/app/ScopedMessages.tsx).
import { AREA_MESSAGE_PATHS, GLOBAL_MESSAGE_PATHS } from "./route-messages.generated";

/// Every part any page can need: what a component rendered on its own (in a
/// test) is given, so a test never passes on a namespace no page sends.
export const CLIENT_MESSAGE_PATHS: readonly string[] = [
  ...new Set<string>([...GLOBAL_MESSAGE_PATHS, ...Object.values(AREA_MESSAGE_PATHS).flat()]),
].sort();

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
    for (const part of parts.slice(0, -1)) {
      const next = dst[part];
      dst = (typeof next === "object" && next ? next : (dst[part] = {})) as Tree;
    }
    dst[parts[parts.length - 1]] = src;
  }
  return out as Partial<T>;
}
