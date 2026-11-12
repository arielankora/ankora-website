import type { AppLocale } from "@/lib/i18n/config";
import type he from "@/messages/he.json";

// ADR 0006: typed keys. A key that is not in the Hebrew dictionary fails
// `tsc`, and the English one must have the same shape (i18n/request.ts).
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof he;
  }
}
