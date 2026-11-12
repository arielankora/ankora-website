import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import he from "../../messages/he.json";
import en from "../../messages/en.json";

/// What app/(product)/layout.tsx gives every client component (ADR 0006),
/// for a component rendered alone in a test. Hebrew unless a test asks.
export function intlWrapper(locale: "he" | "en" = "he") {
  return function IntlWrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale === "he" ? "he-IL" : "en-IL"} messages={locale === "he" ? he : en} timeZone="Asia/Jerusalem">
        {children}
      </NextIntlClientProvider>
    );
  };
}
