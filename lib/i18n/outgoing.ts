import { createFormatter, createTranslator } from "next-intl";
import he from "@/messages/he.json";
import en from "@/messages/en.json";
import { DEFAULT_APP_LOCALE, DEFAULT_TIME_ZONE, directionOf, intlTag, isAppLocale, safeTimeZone, type AppLocale, type IntlTag } from "./config";

// ADR 0006, outgoing channels: what the app sends to a person who has an
// account (a bell row, an email) is written in THAT person's language, not
// the language of whoever caused it.
//
// next-intl's getTranslations reads the current request, which is the
// sender's (or no request at all, in a cron). This builds a translator
// for a recipient instead, from the same dictionaries, so a job that
// writes to ten people writes each one in their own language.
//
// No "server-only" and no database: the pure builders (the digest, the
// urgent message, the reminder texts) take one of these as a parameter,
// and their unit tests build one directly. lib/i18n/recipients.ts reads
// the person's row and returns one.

const MESSAGES: Record<AppLocale, typeof he> = { he, en };

function makeTranslator(locale: AppLocale, timeZone: string) {
  return createTranslator({ locale: intlTag(locale), messages: MESSAGES[locale], timeZone, namespace: "outgoing" });
}

function makeRoot(locale: AppLocale, timeZone: string) {
  return createTranslator({ locale: intlTag(locale), messages: MESSAGES[locale], timeZone });
}

function makeFormatter(locale: AppLocale, timeZone: string) {
  return createFormatter({ locale: intlTag(locale), timeZone });
}

/// The `outgoing` namespace, typed against messages/he.json.
export type OutgoingT = ReturnType<typeof makeTranslator>;

export type Outgoing = {
  locale: AppLocale;
  /// The Intl tag dates and numbers are formatted with (en-IL, not en-US).
  tag: IntlTag;
  timeZone: string;
  /// The email's direction, and the physical side its text starts on.
  /// Mail clients ignore logical CSS often enough that the layouts use
  /// `align` and explicit padding, so they need the side by name.
  dir: "rtl" | "ltr";
  start: "right" | "left";
  end: "left" | "right";
  t: OutgoingT;
  /// The whole dictionary, untyped, for a label another screen already
  /// words the same way (the brain metrics' measures). Prefer `t`.
  root: (key: string, values?: Record<string, string | number>) => string;
  format: ReturnType<typeof createFormatter>;
};

const cache = new Map<string, Outgoing>();

/// Words and dates for one recipient. Anything that is not one of the
/// app's locales (a missing row, an old value) is Hebrew, the default
/// everyone had before they chose.
export function translatorFor(locale?: string | null, timeZone?: string | null): Outgoing {
  const l: AppLocale = isAppLocale(locale) ? locale : DEFAULT_APP_LOCALE;
  const tz = safeTimeZone(timeZone);
  const key = `${l}|${tz}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dir = directionOf(l);
  const out: Outgoing = {
    locale: l,
    tag: intlTag(l),
    timeZone: tz,
    dir,
    start: dir === "rtl" ? "right" : "left",
    end: dir === "rtl" ? "left" : "right",
    t: makeTranslator(l, tz),
    root: makeRoot(l, tz) as unknown as Outgoing["root"],
    format: makeFormatter(l, tz),
  };
  cache.set(key, out);
  return out;
}

/// What a person who has not chosen gets: Hebrew, in Jerusalem time. The
/// default for builders whose callers have no recipient row to ask.
export const HEBREW: Outgoing = translatorFor(DEFAULT_APP_LOCALE, DEFAULT_TIME_ZONE);
