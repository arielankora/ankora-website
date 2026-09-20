import type { Locale } from "@/content";

/**
 * Counted strings for the two locales this site has.
 *
 * The handoff specified these keys as ICU plurals. There is no i18n library here, and
 * adding one — plus its runtime, its build step and its message-extraction tooling —
 * to serve four strings is four strings' worth of value at a build's worth of cost.
 * Hebrew and English share the same shape for the counts we actually use (one versus
 * everything else); Hebrew's dual form does not arise, because none of these strings
 * is ever rendered with a literal 2 in a context where "שני פרקים" would be required.
 *
 * If a third locale or a dual-form count ever appears, this is the one place to change.
 */
export type PluralString = { one: string; other: string };

export function plural(s: PluralString, n: number, _locale?: Locale): string {
  return (n === 1 ? s.one : s.other).replace("{n}", String(n));
}
