import "server-only";
import { getTranslations } from "next-intl/server";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { domainErrorText } from "@/lib/i18n/domain-errors";

// ADR 0006: the refusals the client screen's panels share, in the
// reader's language. A DomainError is worded from its code; a refusal
// for a client not assigned to the person has its own sentence; anything
// else keeps its message, as before.

export async function clientActionError(err: unknown): Promise<string> {
  const t = await getTranslations("clients.page.errors");
  if (err instanceof ForbiddenError) return t("forbiddenNotAssigned");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

/// Source references the person typed that could not be read.
export async function badSourcesError(invalid: string[]): Promise<string> {
  const t = await getTranslations("clients.page.errors");
  return t("badSources", { refs: invalid.join(", ") });
}
