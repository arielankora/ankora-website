import type { Locale } from "@/content";

export function withLocale(locale: Locale, href: string) {
  if (href === "/") return `/${locale}`;
  return `/${locale}${href}`;
}
