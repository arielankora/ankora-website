import { normalizeEmail } from "@/lib/contact-normalize";
import { parseViewerEmails } from "./visibility";

// The account the daily knowledge extraction runs as (14.11.2026, Ariel:
// "Ops יכול לקרוא את הכל ולחלץ ממנו"). It reads every stored conversation
// through the Ankora connector, including a number whose owner kept people
// out of it ("לא רואים שיחות מהמספר"), unless a manager turned that off on
// the number (CommsChannel.extractionAllowed). Nothing changes for any
// person: the exception is for this account, and only through the
// connector (lib/comms/client-comms.ts), never on the screens.
//
// COMMS_EXTRACTION_ACCOUNTS lists the account(s); without it, Ankora Ops.

export const DEFAULT_EXTRACTION_ACCOUNT = "ops@ankora.co.il";

export function isExtractionAccount(email: string | null | undefined, raw: string | undefined = process.env.COMMS_EXTRACTION_ACCOUNTS): boolean {
  const me = normalizeEmail(email ?? "");
  if (!me) return false;
  const listed = parseViewerEmails(raw);
  return (listed.length ? listed : [DEFAULT_EXTRACTION_ACCOUNT]).includes(me);
}
