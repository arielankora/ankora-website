// Email and phone normalization for the client file's people
// (org-brain spec 3.5). Pure: no Prisma, no clock.
//
// The same person is written down many ways: "Shani@Nextage.co.il ",
// "054-123-4567", "+972 54 123 4567". If they are stored as typed, the
// person is created twice, the shared record of decision 8 splits in two,
// and a phone transcript cannot be matched to anyone. So everything goes
// through here before it is stored or compared.

/// Lower case and trimmed, or null when it is not an address at all.
/// Deliberately loose: an address a person typed is checked for shape, not
/// deliverability, and a strict pattern would refuse real addresses.
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

/// The domain of an address, lower case. "shani@nextage.co.il" gives
/// "nextage.co.il".
export function emailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  return normalized ? normalized.slice(normalized.indexOf("@") + 1) : null;
}

/// A domain as stored on an Organization: lower case, no "@", no scheme,
/// no "www.", no path. Null when nothing is left.
export function normalizeDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/^@/, "").replace(/^www\./, "");
  value = value.split("/")[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return null;
  return value;
}

/// The separate numbers in one field: "052-1234567 / 03-1234567",
/// "052-1234567 או 03-1234567", one per line. Commas and semicolons too.
/// Each part is still raw: pass it to normalizePhone.
export function splitPhones(raw: string): string[] {
  return raw
    .split(/[\/|,;\n]+|\s+(?:או|or)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/// E.164 when it can be inferred, otherwise digits with a leading "+" kept.
///
/// - "+972 54-123-4567" and "00972541234567" give "+972541234567".
/// - An Israeli local number ("054-1234567", "03-1234567") gives +972
///   without the leading zero. Israel is the default because almost every
///   number this product sees without a country code is Israeli; a number
///   from elsewhere is written with its "+" and passes through untouched.
/// - The zero that signatures keep after the country code ("+972 (0)54",
///   "+972-054", "972-054") is dropped, and a mobile written without its
///   zero ("54-1234567", nine digits from 5) is Israeli too (27.11.2026,
///   Ariel: the WhatsApp screen must find a contact however the number was
///   written).
/// - Only the first number of a field that holds several, and without its
///   extension ("ext. 12", "שלוחה 12").
/// - An international number from 970 to 979 written with one 0 instead of
///   00 ("0974 4422 1234") gives "+97444221234" (27.11.2026).
/// - Anything shorter than 7 digits is not a phone number. Null.
export function normalizePhone(raw: string): string | null {
  let text = splitPhones(raw)[0] ?? "";
  text = text.split(/(?:\bext\.?|\bextension|\bx|שלוחה|שלו['׳])\s*\d/i)[0];
  text = text.replace(/\(\s*0\s*\)/g, "");
  let plus = /^[^\d]*\+/.test(text);
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  }
  // 27.11.2026: an international number written with one 0 instead of 00
  // ("0974 4422 1234", four contacts of one client, Qatar). Too long to be
  // Israeli. Only a code from 970 to 979 after it. An Israeli number from
  // 09-7 with an extension run into it ("09-7123456 123") reads the same
  // way; it was not a number WhatsApp could match before either.
  if (!plus && /^097\d{9,11}$/.test(digits)) {
    digits = digits.slice(1);
    plus = true;
  }
  if (digits.startsWith("9720")) digits = `972${digits.slice(4)}`;
  if (digits.length < 7) return null;
  if (plus) return `+${digits}`;
  if (digits.startsWith("0") && (digits.length === 9 || digits.length === 10)) return `+972${digits.slice(1)}`;
  if (digits.startsWith("972") && digits.length >= 11) return `+${digits}`;
  if (digits.length === 9 && digits.startsWith("5")) return `+972${digits}`;
  return digits;
}

/// Every number in a list of fields, normalized, without duplicates, in
/// order: what a contact's phones are stored as.
export function normalizePhones(values: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const value of values ?? []) {
    for (const part of splitPhones(value)) {
      const n = normalizePhone(part);
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/// A list typed into one field ("a@x.com, b@y.com" or one per line),
/// normalized, without duplicates, in the order typed. Entries that are
/// not valid are returned separately so the screen can name them.
export function parseList(
  raw: string,
  normalize: (value: string) => string | null
): { values: string[]; invalid: string[] } {
  const values: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const normalized = normalize(trimmed);
    if (!normalized) invalid.push(trimmed);
    else if (!values.includes(normalized)) values.push(normalized);
  }
  return { values, invalid };
}

/// Mail providers everyone uses. Such a domain says nothing about which
/// client a message belongs to, so it can never be registered as one.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "walla.co.il",
  "walla.com",
  "012.net.il",
  "bezeqint.net",
  "netvision.net.il",
  "zahav.net.il",
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}
