import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { pickMessages } from "@/lib/i18n/client-messages";
import { AREA_MESSAGE_PATHS, GLOBAL_MESSAGE_PATHS } from "@/lib/i18n/route-messages.generated";

/// ADR 0006, decision 7: the dictionary parts one area of the app needs in
/// the browser, on top of the shell's. The lists are worked out from the code
/// (scripts/i18n/route-messages.mjs); a layout only names its area.
///
/// Every area folder under app/(product)/app/(authenticated) has a layout
/// with this, named after the folder, even while it needs nothing beyond
/// the shell: then a screen that starts reading the dictionary in the
/// browser only needs the generated list regenerated, never a new layout
/// (tests/unit/i18n-route-messages.test.ts checks both).
///
/// The provider replaces the one above it for everything inside, so it
/// carries the global parts too. Locale and time zone are inherited from the
/// request (i18n/request.ts).
export async function ScopedMessages({ area, children }: { area: string; children: ReactNode }) {
  const own = (AREA_MESSAGE_PATHS as Record<string, readonly string[]>)[area] ?? [];
  const messages = pickMessages(await getMessages(), [...GLOBAL_MESSAGE_PATHS, ...own]);
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
