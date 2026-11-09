// A country or a currency, written the way a person writes it, turned
// into the code an entity stores ("ישראל" -> "IL", "ש\"ח" -> "ILS").
//
// The entity form and the knowledge proposals both reach
// lib/app-domain/client-entities.ts, which stores ISO codes: a country
// in two letters, a currency in three. A proposal that read "ישראל" out
// of a questionnaire was refused on approval ("קוד המדינה לא תקין") and
// left nobody a way to fix it from the approvals screen. Now a name the
// runtime knows, in Hebrew or English, becomes its code; anything else
// is returned as written, and the caller's check refuses it as before.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function key(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'״׳`.,()\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayNames(type: "region" | "currency", locales: string[]): Intl.DisplayNames[] {
  try {
    return locales.map((l) => new Intl.DisplayNames([l], { type, fallback: "none" }));
  } catch {
    return [];
  }
}

let countries: Map<string, string> | null = null;
let currencies: Map<string, string> | null = null;

/// Names people use that the runtime's display names do not cover.
const COUNTRY_ALIASES: Record<string, string> = {
  "ארה\"ב": "US",
  "ארהב": "US",
  "ארצות הברית של אמריקה": "US",
  "אמריקה": "US",
  usa: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  "אנגליה": "GB",
  "הממלכה המאוחדת": "GB",
  "מדינת ישראל": "IL",
  "state of israel": "IL",
  holland: "NL",
  "הולנד": "NL",
};

const CURRENCY_ALIASES: Record<string, string> = {
  "ש\"ח": "ILS",
  "שח": "ILS",
  "שקל": "ILS",
  "שקלים": "ILS",
  "₪": "ILS",
  nis: "ILS",
  shekel: "ILS",
  "דולר": "USD",
  "דולרים": "USD",
  "$": "USD",
  dollar: "USD",
  "אירו": "EUR",
  "יורו": "EUR",
  "€": "EUR",
  euro: "EUR",
  "ליש\"ט": "GBP",
  "לישט": "GBP",
  "פאונד": "GBP",
  "£": "GBP",
  pound: "GBP",
};

function canonicalRegion(code: string): string | null {
  try {
    return Intl.getCanonicalLocales(`und-${code}`)[0]?.slice(4) ?? null;
  } catch {
    return null;
  }
}

function countryMap(): Map<string, string> {
  if (countries) return countries;
  const m = new Map<string, string>();
  const names = displayNames("region", ["he", "en"]);
  for (const a of LETTERS) {
    for (const b of LETTERS) {
      // Deprecated codes ("UK", "BU") answer with the name of the current
      // one; only a code that is its own canonical form goes in the map.
      const code = a + b;
      if (canonicalRegion(code) !== code) continue;
      for (const n of names) {
        const name = n.of(code);
        if (name) m.set(key(name), code);
      }
    }
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) m.set(key(alias), code);
  countries = m;
  return m;
}

function currencyMap(): Map<string, string> {
  if (currencies) return currencies;
  const m = new Map<string, string>();
  const names = displayNames("currency", ["he", "en"]);
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["ILS", "USD", "EUR", "GBP"];
  for (const code of supported) {
    for (const n of names) {
      const name = n.of(code);
      if (name) m.set(key(name), code);
    }
  }
  for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) m.set(key(alias), code);
  currencies = m;
  return m;
}

/// "ישראל", "Israel", "il" -> "IL". Unknown text comes back trimmed, as written.
export function toCountryCode(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  // Names first: "UK" looks like a code and is not one (GB is).
  return countryMap().get(key(s)) ?? (/^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : s);
}

/// "ש\"ח", "שקל חדש", "₪", "usd" -> "ILS" / "USD". Unknown text comes back trimmed, as written.
export function toCurrencyCode(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  // Names first: "NIS" looks like a code and is not one (ILS is).
  return currencyMap().get(key(s)) ?? (/^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : s);
}
