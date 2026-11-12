import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import he from "@/messages/he.json";
import { pickMessages } from "@/lib/i18n/client-messages";

/// Pages that stay in Hebrew whatever the reader's language (ADR 0006):
/// the agreements a person signs and the pages a client opens from a
/// link. Their text is a legal or client-facing document, not an
/// interface, and a translation of it is a decision for a person to make,
/// never a side effect of someone's language setting.
///
/// The direction and language are set here, on a wrapper, because the
/// <html> element above belongs to the reader. The provider makes every
/// shared component inside (the sign-out button, a toast) speak Hebrew
/// too, so the page does not mix the two.
export function HebrewOnly({ children }: { children: ReactNode }) {
  return (
    <div lang="he" dir="rtl">
      <NextIntlClientProvider locale="he-IL" messages={pickMessages(he)}>
        {children}
      </NextIntlClientProvider>
    </div>
  );
}
