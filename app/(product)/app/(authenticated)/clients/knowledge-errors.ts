import "server-only";
import { getTranslations } from "next-intl/server";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { domainErrorText } from "@/lib/i18n/domain-errors";

/// ADR 0006: a refusal from the client file's actions (rules, facts,
/// sources, people, questions) in the reader's language. A DomainError is
/// worded from its code; anything else keeps its message, as before.
export async function knowledgeErrorText(err: unknown): Promise<string> {
  const t = await getTranslations("clients.knowledge.errors");
  if (err instanceof ForbiddenError) return t("forbidden");
  const domain = await domainErrorText(err);
  if (domain) return domain;
  if (err instanceof Error) return err.message;
  return t("generic");
}

/// The same keys, for the actions' own checks before the domain runs.
export async function knowledgeErrorT() {
  return getTranslations("clients.knowledge.errors");
}
export type KnowledgeErrorT = Awaited<ReturnType<typeof knowledgeErrorT>>;
