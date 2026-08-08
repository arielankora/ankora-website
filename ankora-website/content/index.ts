import he from "./he";
import en from "./en";
import type { Locale, Dictionary } from "./types";

export const dictionaries: Record<Locale, Dictionary> = { he, en };
export const locales: Locale[] = ["he", "en"];
export const defaultLocale: Locale = "he";

export function getDictionary(locale: string): Dictionary {
  return dictionaries[(locale as Locale) in dictionaries ? (locale as Locale) : defaultLocale];
}

export type { Locale, Dictionary, SegmentContent, SimplePageContent, PagesContent } from "./types";
