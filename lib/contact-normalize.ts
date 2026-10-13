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

/// E.164 when it can be inferred, otherwise digits with a leading "+" kept.
///
/// - "+972 54-123-4567" and "00972541234567" give "+972541234567".
/// - An Israeli local number ("054-1234567", "03-1234567") gives +972
///   without the leading zero. Israel is the default because almost every
///   number this product sees without a country code is Israeli; a number
///   from elsewhere is written with its "+" and passes through untouched.
/// - Anything shorter than 7 digits is not a phone number. Null.
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (plus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && (digits.length === 9 || digits.length === 10)) {
    digits = digits.slice(1);
    return `+972${digits}`;
  }
  if (digits.startsWith("972") && digits.length >= 11) return `+${digits}`;
  return digits;
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
