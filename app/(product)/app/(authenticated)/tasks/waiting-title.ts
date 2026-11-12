import type { useTranslations } from "next-intl";
import type { TaskBlocker } from "@prisma/client";

/// The words of tasks.detail.block, which this reads.
export type BlockWords = ReturnType<typeof useTranslations<"tasks.detail.block">>;

/// "ממתין ללקוח, 6 ימים", in the reader's language, for every staff screen
/// that shows a wait (the task screen, the list row, the board). The same
/// rule as waitingTitle in lib/app-domain/portal-labels.ts, which stays
/// Hebrew for the morning digest and the prompt "קדם עם קלוד" copies.
///
/// Days rather than a date, because the question is "how long", and whole
/// days rather than hours because a wait measured in hours is not yet a
/// wait anybody needs to act on.
export function waitingTitle(t: BlockWords, on: TaskBlocker, since: string | null): string {
  const label = t(`on.${on}`);
  if (!since) return label;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  if (days < 1) return t("sinceToday", { label });
  if (days === 1) return t("sinceYesterday", { label });
  return t("sinceDays", { label, count: days });
}
