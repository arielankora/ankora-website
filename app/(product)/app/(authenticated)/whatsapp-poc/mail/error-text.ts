import "server-only";
import { getTranslations } from "next-intl/server";

/// A refusal that came back in the query as its code (?err=mailScan.*), in
/// the reader's language. Only a code under domainErrors.mailScan is read.
export async function mailScanErrorText(code: string): Promise<string | null> {
  const key = code.replace(/^mailScan\./, "");
  if (!/^\w+$/.test(key)) return null;
  const path = ["mailScan", key].join(".");
  const t = await getTranslations();
  const full = ["domainErrors", path].join(".");
  return t.has(full as never) ? t(full as never) : null;
}
