import type { Locale } from "../types";
import type { SecurityPageContent } from "./types";
import he from "./he";
import en from "./en";

const content: Record<Locale, SecurityPageContent> = { he, en };

export function getSecurityContent(locale: Locale): SecurityPageContent {
  return content[locale];
}

export type { SecurityPageContent } from "./types";
export { SECURITY_GATES, isOpen, openOnly, openText, type SecurityGate, type Gated } from "./gates";
