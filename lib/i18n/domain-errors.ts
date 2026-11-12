import "server-only";
import { getTranslations } from "next-intl/server";
import { DomainError } from "@/lib/domain-error";

// ADR 0006: the sentence for a DomainError, in the reader's language.
// Anything else returns null, and the caller keeps deciding what a fault
// looks like, exactly as it did before.
export async function domainErrorText(err: unknown): Promise<string | null> {
  if (!(err instanceof DomainError)) return null;
  const t = await getTranslations("domainErrors");
  // The code is a dynamic key; tests/unit/i18n-domain-errors.test.ts
  // checks that every code thrown in lib/ exists in both dictionaries.
  return (t as unknown as (key: string, values?: Record<string, string | number>) => string)(err.code, err.values);
}
