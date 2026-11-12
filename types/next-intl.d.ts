import type { IntlTag } from "@/lib/i18n/config";
import type he from "@/messages/he.json";

// ADR 0006: typed keys. A key that is not in the Hebrew dictionary fails
// `tsc`, and the English one must have the same shape (i18n/request.ts).
//
// next-intl's locale is the Intl tag, not the bare language: it is what
// every date and number is formatted with, and "en" alone formats US
// style (9/23, 3:05 PM) where the decision is en-IL (23/09, 15:05).
declare module "next-intl" {
  interface AppConfig {
    Locale: IntlTag;
    Messages: typeof he;
  }
}
