// The link on a credential. Pure, so it can be tested without a database.
import { DomainError } from "@/lib/domain-error";

const MAX = 2048;

const LINK_HELP =
  "בשדה הקישור אפשר רק כתובת אתר, למשל www.example.co.il. לקובץ או למערכת בלי כתובת, להשאיר ריק ולכתוב את הפרטים בהערות.";

/// http and https only. The link is rendered as an anchor that people
/// click, so `javascript:` or `data:` here would be stored XSS.
export function cleanUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new DomainError("credentials.linkInvalid", LINK_HELP);
  const v = value.trim();
  if (!v) return null;
  if (v.length > MAX) throw new DomainError("credentials.linkTooLong", `קישור: עד ${MAX} תווים.`, { max: String(MAX) });
  // A phrase is a description, not an address. 6.10.2026: the first real
  // entry put "אקסל מפיננס" here.
  if (/\s/.test(v)) throw new DomainError("credentials.linkInvalid", LINK_HELP);
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
  } catch {
    throw new DomainError("credentials.linkInvalid", LINK_HELP);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new DomainError("credentials.linkInvalid", LINK_HELP);
  // A single word ("אקסל") parses as a host and would be saved as
  // https://xn--.../, a link to nowhere. A real address has a domain.
  if (!parsed.hostname.includes(".")) throw new DomainError("credentials.linkInvalid", LINK_HELP);
  return parsed.toString();
}
