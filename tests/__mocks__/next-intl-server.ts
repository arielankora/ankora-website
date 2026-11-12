import { createFormatter, createTranslator } from "next-intl";
import he from "../../messages/he.json";

// ADR 0006. Integration tests call server actions and route handlers
// directly, outside a Next request, where next-intl's request config
// (i18n/request.ts) cannot run. This stands in for next-intl/server with
// what a request from someone who has not chosen a language gets: Hebrew,
// in Jerusalem time. The strings asserted in those tests are therefore the
// exact Hebrew the app shows, read from the same dictionary.

const config = { locale: "he" as const, messages: he, timeZone: "Asia/Jerusalem" };

export async function getTranslations(namespace?: string) {
  return createTranslator({ ...config, namespace: namespace as never });
}

export async function getFormatter() {
  return createFormatter(config);
}

export async function getLocale() {
  return config.locale;
}

export async function getMessages() {
  return config.messages;
}

export async function getTimeZone() {
  return config.timeZone;
}
