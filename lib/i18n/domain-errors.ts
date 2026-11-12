import "server-only";
import { getTranslations } from "next-intl/server";
import { DomainError } from "@/lib/domain-error";

// ADR 0006: the sentence for a DomainError, in the reader's language.
// Anything else returns null, and the caller keeps deciding what a fault
// looks like, exactly as it did before.
export async function domainErrorText(err: unknown): Promise<string | null> {
  if (!(err instanceof DomainError)) return null;
  // The code is a dynamic key, so it is looked up from the root and not
  // type-checked; tests/unit/i18n-domain-errors.test.ts checks instead
  // that every code thrown exists in both dictionaries.
  const t = (await getTranslations()) as unknown as (key: string, values?: Record<string, string | number>) => string;
  return t(`domainErrors.${err.code}`, err.values);
}
