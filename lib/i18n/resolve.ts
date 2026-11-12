import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/app-auth/session";
import { APP_LOCALE_COOKIE, DEFAULT_APP_LOCALE, DEFAULT_TIME_ZONE, isAppLocale, type AppLocale } from "./config";

// Which language and time zone this request is rendered in (ADR 0006).
//
// The signed-in person's own row decides. The cookie is consulted only
// when nobody is signed in (the sign-in screens, a session that has just
// expired), and anything it holds that is not one of our locales is
// ignored rather than trusted: it is a value the browser sends.

export function pickLocale(userLocale: AppLocale | null | undefined, cookieValue: string | null | undefined): AppLocale {
  if (userLocale && isAppLocale(userLocale)) return userLocale;
  if (isAppLocale(cookieValue)) return cookieValue;
  return DEFAULT_APP_LOCALE;
}

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

export const resolveRequestLocale = cache(async (): Promise<{ locale: AppLocale; timeZone: string }> => {
  // getCurrentUser() is already cached for the request, so the layout,
  // the page and this share one database read. A failure to read the
  // user is a page in the default language, never a page that fails.
  const user = await getCurrentUser().catch(() => null);
  const cookieValue = user ? null : (await cookies()).get(APP_LOCALE_COOKIE)?.value;
  return {
    locale: pickLocale(user?.locale, cookieValue),
    timeZone: safeTimeZone(user?.timezone),
  };
});
