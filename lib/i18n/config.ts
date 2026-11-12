// The app's interface languages (ADR 0006). Shared by the server (request
// config, layouts, actions) and the browser (the language form), so it
// imports nothing that only one side can load.
//
// The marketing site under app/[locale] has its own dictionaries
// (content/he.ts, content/en.ts) and its own routing. The two never share
// a dictionary: the site is copy, the app is an interface, and a change to
// one should never move the other.

import type { AppLocale } from "@prisma/client";

export type { AppLocale };

export const APP_LOCALES = ["he", "en"] as const satisfies readonly AppLocale[];

/// Everyone who has not chosen, and every page nobody is signed in to.
export const DEFAULT_APP_LOCALE: AppLocale = "he";

/// Remembers the last choice on this browser, so the sign-in screen that
/// comes before any user is known already speaks the right language. The
/// person's own row is the source of truth: the cookie is only read when
/// there is no signed-in user to ask.
export const APP_LOCALE_COOKIE = "ankora_app_locale";

/// A year: it is a preference, not a session, and it holds nothing secret.
export const APP_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/// Every person's time zone until they choose one (User.timezone's default).
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";

/// A time zone Intl accepts, or the default. User.timezone is free text
/// (TimezoneForm.tsx says why), and one bad value must not take every
/// formatted date on every screen down with it.
export function safeTimeZone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: AppLocale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

/// The tag Intl formats dates and numbers with. English is en-IL and not
/// en-US: the work is in Israel, so a date reads day first, a time is 24
/// hours, and money is in shekels, the way the Hebrew screens show them.
export type IntlTag = "he-IL" | "en-IL";

export function intlTag(locale: AppLocale): IntlTag {
  return locale === "he" ? "he-IL" : "en-IL";
}

/// Each language's own name, written in that language, for the picker.
export const LOCALE_NATIVE_NAMES: Record<AppLocale, string> = {
  he: "עברית",
  en: "English",
};
