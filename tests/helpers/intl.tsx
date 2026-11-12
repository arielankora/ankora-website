import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import he from "../../messages/he.json";
import en from "../../messages/en.json";
import { pickMessages } from "@/lib/i18n/client-messages";

/// What app/(product)/layout.tsx gives every client component (ADR 0006),
/// for a component rendered alone in a test. Hebrew unless a test asks.
/// The same slice of the dictionary the browser gets (pickMessages), so a
/// component reading a namespace the browser is not sent fails here.
export function intlWrapper(locale: "he" | "en" = "he") {
  return function IntlWrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale === "he" ? "he-IL" : "en-IL"} messages={pickMessages(locale === "he" ? he : en)} timeZone="Asia/Jerusalem">
        {children}
      </NextIntlClientProvider>
    );
  };
}
