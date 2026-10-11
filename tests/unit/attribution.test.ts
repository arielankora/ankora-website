import { describe, expect, it } from "vitest";
import {
  attributionEmailLines,
  describeSource,
  deviceFromUserAgent,
  normalizeAttribution,
  parseGaClientId,
  parseGaSessionId,
  sanitizePath,
  sanitizeReferrer,
  serverContextFrom,
  touchFrom,
} from "@/lib/attribution";

// 11.10.2026: a lead arrived and nothing could say where from
// (claude/lead-attribution-gap-2026-10-11.md). These pin what the form now
// carries and, as much, what it refuses to carry.

const AT = new Date("2026-10-11T07:00:00Z");

describe("what is kept from a URL", () => {
  it("keeps the path and the campaign parameters, nothing else", () => {
    expect(
      sanitizePath("https://www.ankora.co.il/he/pricing?utm_source=linkedin&utm_medium=social&email=a@b.co&token=x")
    ).toBe("/he/pricing?utm_source=linkedin&utm_medium=social");
  });

  it("keeps ad click ids, which identify a paid click without utm tags", () => {
    expect(sanitizePath("/he?gclid=abc&foo=1")).toBe("/he?gclid=abc");
  });

  it("keeps an external referrer as origin and path, drops its query", () => {
    expect(sanitizeReferrer("https://www.linkedin.com/feed/?trk=x")).toBe("https://www.linkedin.com/feed/");
    expect(sanitizeReferrer("https://www.google.com/")).toBe("https://www.google.com");
  });

  it("treats our own pages, previews and empty values as no referrer", () => {
    expect(sanitizeReferrer("https://www.ankora.co.il/he/about")).toBe("");
    expect(sanitizeReferrer("https://ankora.co.il/")).toBe("");
    expect(sanitizeReferrer("https://ankora-website-abc.vercel.app/he")).toBe("");
    expect(sanitizeReferrer("")).toBe("");
    expect(sanitizeReferrer("not a url")).toBe("");
  });

  it("keeps an Android app referrer, which is how the LinkedIn app reports itself", () => {
    expect(sanitizeReferrer("android-app://com.linkedin.android/")).toBe("android-app://com.linkedin.android");
  });
});

describe("source / medium, in GA4's words", () => {
  const t = (href: string, ref = "") => touchFrom(href, ref, AT);

  it("utm tags win", () => {
    expect(describeSource(t("https://www.ankora.co.il/he?utm_source=newsletter&utm_medium=email"))).toBe("newsletter / email");
  });
  it("a Google Ads click without utm is google / cpc", () => {
    expect(describeSource(t("https://www.ankora.co.il/he?gclid=1"))).toBe("google / cpc");
  });
  it("search engines are organic, whatever the country domain", () => {
    expect(describeSource(t("https://www.ankora.co.il/he", "https://www.google.co.il/"))).toBe("google / organic");
    expect(describeSource(t("https://www.ankora.co.il/he", "https://www.bing.com/"))).toBe("bing / organic");
  });
  it("social, including the LinkedIn app", () => {
    expect(describeSource(t("https://www.ankora.co.il/he", "https://www.linkedin.com/"))).toBe("linkedin / social");
    expect(describeSource(t("https://www.ankora.co.il/he", "https://lnkd.in/abc"))).toBe("linkedin / social");
    expect(describeSource(t("https://www.ankora.co.il/he", "android-app://com.linkedin.android/"))).toBe("linkedin / social");
  });
  it("AI assistants are named as such", () => {
    expect(describeSource(t("https://www.ankora.co.il/he", "https://chatgpt.com/"))).toBe("chatgpt.com / ai assistant");
  });
  it("anything else is a referral, and nothing is direct", () => {
    expect(describeSource(t("https://www.ankora.co.il/he", "https://example.org/list"))).toBe("example.org / referral");
    expect(describeSource(t("https://www.ankora.co.il/he"))).toBe("(direct) / (none)");
    expect(describeSource(undefined)).toMatch(/^unknown/);
  });
});

describe("GA4 cookies", () => {
  it("reads the client id User explorer searches by", () => {
    expect(parseGaClientId("GA1.1.1234567890.1700000000")).toBe("1234567890.1700000000");
    expect(parseGaClientId("garbage")).toBe("");
    expect(parseGaClientId(undefined)).toBe("");
  });
  it("reads the session id in both cookie formats", () => {
    expect(parseGaSessionId("GS1.1.1700000000.3.1.1700000100.0.0.0")).toBe("1700000000");
    expect(parseGaSessionId("GS2.1.s1700000000$o3$g1$t1700000100$j60$l0$h0")).toBe("1700000000");
    expect(parseGaSessionId("x")).toBe("");
  });
});

describe("the server does not trust the browser", () => {
  it("drops what is malformed instead of refusing the lead", () => {
    expect(normalizeAttribution(null)).toEqual({});
    expect(normalizeAttribution("x")).toEqual({});
    expect(normalizeAttribution({ visitNumber: -3, gaClientId: "<script>", pages: "no" })).toEqual({});
  });

  it("re-sanitises paths and referrers sent by the browser", () => {
    const a = normalizeAttribution({
      sessionTouch: {
        at: AT.toISOString(),
        landing: "/he/pricing?email=a@b.co&utm_source=x",
        referrer: "https://www.ankora.co.il/he",
        utm: { utm_source: "x", evil: "y" },
        clickIds: {},
      },
      pages: [{ p: "/he?token=secret", t: AT.toISOString() }, { p: "/he/contact", t: "not a date" }],
      visitNumber: 2,
      gaClientId: "1.2",
      gaSessionId: "1700000000",
    });
    expect(a.sessionTouch).toEqual({
      at: AT.toISOString(),
      landing: "/he/pricing?utm_source=x",
      referrer: "",
      utm: { utm_source: "x" },
      clickIds: {},
    });
    expect(a.pages).toEqual([{ p: "/he", t: AT.toISOString() }]);
    expect(a.visitNumber).toBe(2);
    expect(a.gaClientId).toBe("1.2");
    expect(a.gaSessionId).toBe("1700000000");
  });

  it("keeps at most the last forty pages", () => {
    const pages = Array.from({ length: 60 }, (_, i) => ({ p: `/he/p${i}`, t: AT.toISOString() }));
    const a = normalizeAttribution({ pages });
    expect(a.pages).toHaveLength(40);
    expect(a.pages?.[0].p).toBe("/he/p20");
  });
});

describe("device", () => {
  it("tells a phone from a laptop and names in-app browsers", () => {
    const iphoneLinkedIn =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]";
    expect(deviceFromUserAgent(iphoneLinkedIn)).toEqual({ type: "mobile", os: "iOS", browser: "LinkedIn in-app" });
    const mac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    expect(deviceFromUserAgent(mac)).toEqual({ type: "desktop", os: "macOS", browser: "Chrome" });
    expect(deviceFromUserAgent(undefined).type).toBe("unknown");
  });
});

describe("the email to info@", () => {
  const headers = new Headers({
    "x-vercel-ip-country": "IL",
    "x-vercel-ip-city": "Tel%20Aviv",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
  });

  it("says where from, what was read and for how long, in Israel time", () => {
    const st = touchFrom("https://www.ankora.co.il/he/pricing", "https://www.google.com/", new Date("2026-10-11T06:58:00Z"));
    const ft = touchFrom("https://www.ankora.co.il/he?utm_source=linkedin&utm_medium=social", "", new Date("2026-10-09T12:00:00Z"));
    const text = attributionEmailLines(
      {
        firstTouch: ft,
        sessionTouch: st,
        visitNumber: 2,
        pages: [
          { p: "/he/pricing", t: "2026-10-11T06:58:00.000Z" },
          { p: "/he/contact", t: "2026-10-11T07:01:30.000Z" },
        ],
        gaClientId: "1.2",
      },
      serverContextFrom(headers, new Date("2026-10-11T07:03:04Z"))
    ).join("\n");

    expect(text).toContain("This visit: google / organic, referrer https://www.google.com");
    expect(text).toContain("Landing page: /he/pricing");
    expect(text).toContain("First visit: 09/10/2026, 15:00:00, linkedin / social");
    expect(text).toContain("Visit: returning, visit #2");
    expect(text).toContain("Pages this visit (2, 5m 4s until the form was sent):");
    expect(text).toContain("  09:58:00  /he/pricing");
    expect(text).toContain("  10:01:30  /he/contact");
    expect(text).toContain("Location (from IP): Tel Aviv, IL");
    expect(text).toContain("Device: mobile, iOS, Safari");
    expect(text).toContain("GA4 client id: 1.2");
  });

  it("says so plainly when there is no history", () => {
    const text = attributionEmailLines({}, serverContextFrom(new Headers(), AT)).join("\n");
    expect(text).toContain("No visit history was sent");
    expect(text).toContain("Location (from IP): -");
  });
});

describe("lead retention", () => {
  it("is 24 months to the day", async () => {
    const { leadRetentionCutoff, LEAD_RETENTION_MONTHS } = await import("@/lib/website-leads");
    expect(LEAD_RETENTION_MONTHS).toBe(24);
    expect(leadRetentionCutoff(new Date("2026-10-11T05:00:00Z")).toISOString()).toBe("2024-10-11T05:00:00.000Z");
  });
});
