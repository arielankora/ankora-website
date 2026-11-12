import { getRequestConfig } from "next-intl/server";
import { resolveRequestLocale } from "@/lib/i18n/resolve";
import type { AppLocale } from "@/lib/i18n/config";
import he from "@/messages/he.json";
import en from "@/messages/en.json";

// next-intl's per-request configuration (ADR 0006), found by the plugin in
// next.config.mjs at this conventional path. The app has no locale in its
// URLs: an internal tool's language belongs to the person, not the link,
// and a link pasted to a colleague must open in the colleague's language.
//
// Both dictionaries are imported statically. They are small next to the
// app, and a static import fails the build when a file goes missing,
// where a dynamic one would fail a person's page.
const MESSAGES: Record<AppLocale, typeof he> = { he, en };

export default getRequestConfig(async () => {
  const { locale, timeZone } = await resolveRequestLocale();
  return { locale, timeZone, messages: MESSAGES[locale] };
});
