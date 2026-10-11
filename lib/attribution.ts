/// How a person reached the site, carried with their contact request.
///
/// 11.10.2026. A lead arrived (form at 07:03 UTC, a booked call 32 seconds
/// later) and nothing could say where it came from: the form sent name,
/// email, phone and areas; Vercel runtime logs on this plan last one hour;
/// GA4 had not processed the day yet; Search Console runs three days
/// behind. See claude/lead-attribution-gap-2026-10-11.md.
///
/// So the browser keeps a small record of the visit (lib/attribution-client.ts)
/// and the form sends it with the request. This file is the part both sides
/// share: the shape, the sanitising, and the plain-language summary that goes
/// into the email to info@. It has no browser or server dependencies, so it
/// is unit tested directly (tests/unit/attribution.test.ts).
///
/// What is deliberately NOT kept:
///   - query strings, except the campaign parameters listed below. A URL can
///     carry an email address or a token, and a lead record is not the place
///     for either.
///   - the referrer's path and query. Its origin and path say where the person
///     came from; the query is somebody else's data.
///   - anything at all from inside the client area (/app). The tracker is only
///     mounted on the marketing site.

export const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

/// Ad-platform click identifiers. Their presence alone tells which platform
/// sent a paid click, even when a campaign forgot its utm tags.
export const CLICK_ID_PARAMS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "li_fat_id"] as const;

export type CampaignParam = (typeof CAMPAIGN_PARAMS)[number];
export type ClickIdParam = (typeof CLICK_ID_PARAMS)[number];

/// One arrival: the first page of a visit and what was known at that moment.
export interface Touch {
  /// ISO time of the first page view of the visit.
  at: string;
  /// Path of the landing page, with only the campaign parameters kept.
  landing: string;
  /// Origin and path of the external page that linked here, or "" for none.
  referrer: string;
  utm: Partial<Record<CampaignParam, string>>;
  clickIds: Partial<Record<ClickIdParam, string>>;
}

export interface PageView {
  /// Sanitised path.
  p: string;
  /// ISO time.
  t: string;
}

/// What the form sends. Every field is optional on the wire: storage can be
/// blocked, and a lead must never be refused because its history is missing.
export interface Attribution {
  /// The very first arrival this browser recorded.
  firstTouch?: Touch;
  /// The arrival that started the current visit.
  sessionTouch?: Touch;
  /// 1 on the first visit; counts visits separated by 30 idle minutes.
  visitNumber?: number;
  /// Pages of the current visit, in order, the form page included.
  pages?: PageView[];
  /// GA4 identifiers, to find the same person in GA4 (User explorer).
  gaClientId?: string;
  gaSessionId?: string;
}

/// A visit ends after this much inactivity, the same rule GA4 uses.
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const MAX_PAGES = 40;

const MAX_VALUE = 200;
const MAX_PATH = 300;

function clip(v: unknown, max = MAX_VALUE): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/// Hosts that are this site. A link from one of our own pages is not a source.
export function isOwnHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === "ankora.co.il" || h === "localhost" || h.endsWith(".vercel.app");
}

/// Path plus the campaign and click-id parameters, nothing else.
export function sanitizePath(href: string, base = "https://www.ankora.co.il"): string {
  try {
    const u = new URL(href, base);
    const kept = new URLSearchParams();
    for (const k of [...CAMPAIGN_PARAMS, ...CLICK_ID_PARAMS]) {
      const v = u.searchParams.get(k);
      if (v) kept.set(k, v.slice(0, MAX_VALUE));
    }
    const q = kept.toString();
    return (u.pathname + (q ? `?${q}` : "")).slice(0, MAX_PATH);
  } catch {
    return "";
  }
}

/// The external referrer as origin + path, or "" when it is empty, ours, or
/// not a web URL.
export function sanitizeReferrer(referrer: string): string {
  if (!referrer) return "";
  try {
    const u = new URL(referrer);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      // android-app://com.linkedin.android/ and the like: the app is the source.
      return u.protocol === "android-app:" ? `${u.protocol}//${u.host}`.slice(0, MAX_VALUE) : "";
    }
    if (isOwnHost(u.hostname)) return "";
    return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`.slice(0, MAX_VALUE);
  } catch {
    return "";
  }
}

/// Builds the arrival record for a page load.
export function touchFrom(href: string, referrer: string, at: Date): Touch {
  const utm: Touch["utm"] = {};
  const clickIds: Touch["clickIds"] = {};
  try {
    const u = new URL(href);
    for (const k of CAMPAIGN_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) utm[k] = v.slice(0, MAX_VALUE);
    }
    for (const k of CLICK_ID_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) clickIds[k] = v.slice(0, MAX_VALUE);
    }
  } catch {
    // An unparsable href still gets a touch, just without parameters.
  }
  return { at: at.toISOString(), landing: sanitizePath(href), referrer: sanitizeReferrer(referrer), utm, clickIds };
}

/// A page load that carries its own campaign or an external referrer starts
/// a new visit even inside the idle window, like GA4 does: it is a new arrival.
export function isNewArrival(t: Touch): boolean {
  return Boolean(t.referrer) || Object.keys(t.utm).length > 0 || Object.keys(t.clickIds).length > 0;
}

/// `_ga=GA1.1.1234567890.1700000000` -> "1234567890.1700000000", the id GA4's
/// User explorer searches by.
export function parseGaClientId(cookieValue: string | undefined): string {
  if (!cookieValue) return "";
  const parts = cookieValue.split(".");
  if (parts.length < 4) return "";
  const id = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return /^\d+\.\d+$/.test(id) ? id : "";
}

/// `_ga_<id>` in either format GA has used:
///   GS1.1.1700000000.3.1.1700000100.0.0.0  -> 1700000000
///   GS2.1.s1700000000$o3$g1$t1700000100... -> 1700000000
export function parseGaSessionId(cookieValue: string | undefined): string {
  if (!cookieValue) return "";
  const gs2 = /^GS2\.\d+\.s(\d+)/.exec(cookieValue);
  if (gs2) return gs2[1];
  const gs1 = /^GS1\.\d+\.(\d+)\./.exec(cookieValue);
  return gs1 ? gs1[1] : "";
}

function normalizeTouch(v: unknown): Touch | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const at = clip(o.at, 40);
  if (!at || Number.isNaN(Date.parse(at))) return undefined;
  const utm: Touch["utm"] = {};
  const clickIds: Touch["clickIds"] = {};
  const u = (o.utm ?? {}) as Record<string, unknown>;
  const c = (o.clickIds ?? {}) as Record<string, unknown>;
  for (const k of CAMPAIGN_PARAMS) if (clip(u[k])) utm[k] = clip(u[k]);
  for (const k of CLICK_ID_PARAMS) if (clip(c[k])) clickIds[k] = clip(c[k]);
  return {
    at: new Date(at).toISOString(),
    // Re-sanitised on the server: the browser is not trusted to have done it.
    landing: sanitizePath(clip(o.landing, MAX_PATH)),
    referrer: sanitizeReferrer(clip(o.referrer)),
    utm,
    clickIds,
  };
}

/// The server's view of what the browser sent: every field checked, clipped
/// and re-sanitised. Anything malformed is dropped, never rejected.
export function normalizeAttribution(raw: unknown): Attribution {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Attribution = {};
  const ft = normalizeTouch(o.firstTouch);
  const st = normalizeTouch(o.sessionTouch);
  if (ft) out.firstTouch = ft;
  if (st) out.sessionTouch = st;
  if (typeof o.visitNumber === "number" && Number.isInteger(o.visitNumber) && o.visitNumber > 0) {
    out.visitNumber = Math.min(o.visitNumber, 100_000);
  }
  if (Array.isArray(o.pages)) {
    const pages: PageView[] = [];
    for (const p of o.pages.slice(-MAX_PAGES)) {
      if (!p || typeof p !== "object") continue;
      const path = sanitizePath(clip((p as Record<string, unknown>).p, MAX_PATH));
      const t = clip((p as Record<string, unknown>).t, 40);
      if (path && t && !Number.isNaN(Date.parse(t))) pages.push({ p: path, t: new Date(t).toISOString() });
    }
    if (pages.length) out.pages = pages;
  }
  const cid = clip(o.gaClientId, 60);
  const sid = clip(o.gaSessionId, 30);
  if (/^\d+\.\d+$/.test(cid)) out.gaClientId = cid;
  if (/^\d+$/.test(sid)) out.gaSessionId = sid;
  return out;
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia)\./;
const SOCIAL: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$|^lnkd\.in$|com\.linkedin\.android/, "linkedin"],
  [/(^|\.)(facebook\.com|fb\.com|m\.facebook\.com)$|com\.facebook/, "facebook"],
  [/(^|\.)instagram\.com$|com\.instagram/, "instagram"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)(whatsapp\.com|wa\.me)$|com\.whatsapp/, "whatsapp"],
  [/(^|\.)youtube\.com$/, "youtube"],
];
const AI = /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/;

/// "source / medium", in GA4's vocabulary, so the email and GA4 read the same.
export function describeSource(t: Touch | undefined): string {
  if (!t) return "unknown (no history in this browser)";
  if (t.utm.utm_source || t.utm.utm_medium) {
    return `${t.utm.utm_source ?? "(not set)"} / ${t.utm.utm_medium ?? "(not set)"}`;
  }
  if (t.clickIds.gclid || t.clickIds.gbraid || t.clickIds.wbraid) return "google / cpc";
  if (t.clickIds.fbclid) return "facebook / paid or social (fbclid)";
  if (t.clickIds.msclkid) return "bing / cpc";
  if (t.clickIds.li_fat_id) return "linkedin / cpc";
  if (!t.referrer) return "(direct) / (none)";
  let host = "";
  try {
    host = new URL(t.referrer).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "(direct) / (none)";
  }
  if (AI.test(host)) return `${host} / ai assistant`;
  if (SEARCH.test(host)) return `${host.split(".").find((p) => SEARCH.test(`${p}.`)) ?? host} / organic`;
  for (const [re, name] of SOCIAL) if (re.test(host)) return `${name} / social`;
  return `${host} / referral`;
}

export interface ServerContext {
  receivedAt: Date;
  country?: string;
  region?: string;
  city?: string;
  userAgent?: string;
}

export interface Device {
  type: "mobile" | "tablet" | "desktop" | "unknown";
  os: string;
  browser: string;
}

/// Enough of the user agent to answer "phone or laptop, which browser".
export function deviceFromUserAgent(ua: string | undefined): Device {
  if (!ua) return { type: "unknown", os: "", browser: "" };
  const type: Device["type"] = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)
    ? "tablet"
    : /Mobi|iPhone|Android/i.test(ua)
      ? "mobile"
      : "desktop";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  // In-app browsers first: they matter for attribution (a LinkedIn or
  // WhatsApp in-app view usually sends no referrer at all).
  const browser = /LinkedInApp/.test(ua)
    ? "LinkedIn in-app"
    : /FBAN|FBAV/.test(ua)
      ? "Facebook in-app"
      : /Instagram/.test(ua)
        ? "Instagram in-app"
        : /WhatsApp/.test(ua)
          ? "WhatsApp in-app"
          : /Edg\//.test(ua)
            ? "Edge"
            : /SamsungBrowser/.test(ua)
              ? "Samsung Internet"
              : /CriOS|Chrome\//.test(ua)
                ? "Chrome"
                : /FxiOS|Firefox\//.test(ua)
                  ? "Firefox"
                  : /Safari\//.test(ua)
                    ? "Safari"
                    : "";
  return { type, os, browser };
}

function israelTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

function touchLine(t: Touch): string {
  const bits = [describeSource(t)];
  if (t.utm.utm_campaign) bits.push(`campaign "${t.utm.utm_campaign}"`);
  if (t.utm.utm_term) bits.push(`term "${t.utm.utm_term}"`);
  if (t.utm.utm_content) bits.push(`content "${t.utm.utm_content}"`);
  if (t.referrer) bits.push(`referrer ${t.referrer}`);
  return bits.join(", ");
}

/// The lines added to the email to info@. Plain text, English labels, the
/// same as the rest of that email. Times are Israel time.
export function attributionEmailLines(a: Attribution, ctx: ServerContext): string[] {
  const lines: string[] = ["", "How they arrived (times are Israel time):"];
  const st = a.sessionTouch;
  const ft = a.firstTouch;

  if (!st && !ft) {
    lines.push("No visit history was sent (storage blocked, or an old cached page).");
  }
  if (st) {
    lines.push(`This visit: ${touchLine(st)}`);
    lines.push(`Landing page: ${st.landing || "-"}`);
  }
  if (ft && (!st || ft.at !== st.at)) {
    lines.push(`First visit: ${israelTime(ft.at)}, ${touchLine(ft)}, landing ${ft.landing || "-"}`);
  }
  if (a.visitNumber) {
    lines.push(a.visitNumber === 1 ? "Visit: first visit" : `Visit: returning, visit #${a.visitNumber}`);
  }

  const pages = a.pages ?? [];
  if (pages.length) {
    const start = st?.at ?? pages[0].t;
    const spent = duration(ctx.receivedAt.getTime() - Date.parse(start));
    lines.push(`Pages this visit (${pages.length}${spent ? `, ${spent} until the form was sent` : ""}):`);
    for (const p of pages) lines.push(`  ${israelTime(p.t).slice(-8)}  ${p.p}`);
  }

  const place = [ctx.city, ctx.region, ctx.country].filter(Boolean).join(", ");
  const dev = deviceFromUserAgent(ctx.userAgent);
  lines.push(`Location (from IP): ${place || "-"}`);
  lines.push(`Device: ${[dev.type, dev.os, dev.browser].filter(Boolean).join(", ") || "-"}`);
  if (a.gaClientId) {
    lines.push(
      `GA4 client id: ${a.gaClientId}${a.gaSessionId ? `, session ${a.gaSessionId}` : ""} (GA4 > Explore > User explorer)`
    );
  }
  return lines;
}

/// Decodes Vercel's geo headers. City arrives URL-encoded ("Tel%20Aviv").
export function serverContextFrom(headers: Headers, receivedAt: Date): ServerContext {
  const dec = (v: string | null) => {
    if (!v) return undefined;
    try {
      return decodeURIComponent(v).slice(0, 100);
    } catch {
      return v.slice(0, 100);
    }
  };
  return {
    receivedAt,
    country: dec(headers.get("x-vercel-ip-country")),
    region: dec(headers.get("x-vercel-ip-country-region")),
    city: dec(headers.get("x-vercel-ip-city")),
    userAgent: headers.get("user-agent")?.slice(0, 500) ?? undefined,
  };
}
