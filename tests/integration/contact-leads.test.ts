import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { POST } from "@/app/api/contact/route";

// 11.10.2026: a contact request is now a row as well as an email, and both
// carry how the person reached the site (lib/attribution.ts). The email to
// info@ stays the alert; what is tested here is that the row exists, that it
// exists even when the email fails, and that a broken history never costs
// the lead. Resend is replaced with a stub; nothing leaves the test.

const sent: { subject: string; text: string }[] = [];
let resendStatus = 200;
const savedKey = process.env.RESEND_API_KEY;

beforeEach(() => {
  sent.length = 0;
  resendStatus = 200;
  __resetRateLimitsForTests();
  process.env.RESEND_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sent.push({ subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: "msg_test" }), { status: resendStatus });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://www.ankora.co.il/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
}

const visit = {
  firstTouch: {
    at: "2026-10-09T12:00:00.000Z",
    landing: "/he?utm_source=linkedin&utm_medium=social&utm_campaign=mental-load",
    referrer: "",
    utm: { utm_source: "linkedin", utm_medium: "social", utm_campaign: "mental-load" },
    clickIds: {},
  },
  sessionTouch: {
    at: "2026-10-11T06:58:00.000Z",
    landing: "/he/pricing",
    referrer: "https://www.google.com",
    utm: {},
    clickIds: {},
  },
  visitNumber: 2,
  pages: [
    { p: "/he/pricing", t: "2026-10-11T06:58:00.000Z" },
    { p: "/he/contact", t: "2026-10-11T07:01:30.000Z" },
  ],
  gaClientId: "1234567890.1700000000",
};

describe("POST /api/contact", () => {
  it("records the lead with how they arrived, and says it in the email", async () => {
    const res = await POST(
      request(
        { name: "בדיקה", email: "lead@example.com", phone: "050-0000000", areas: ["ניהול נכסים ומשק בית"], locale: "he", attribution: visit },
        { "x-vercel-ip-country": "IL", "x-vercel-ip-city": "Tel%20Aviv", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1" }
      )
    );
    expect(res.status).toBe(200);

    const rows = await prisma.websiteLead.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "בדיקה",
      email: "lead@example.com",
      areas: ["ניהול נכסים ומשק בית"],
      locale: "he",
      source: "google / organic",
      firstSource: "linkedin / social",
      landingPage: "/he/pricing",
      referrer: "https://www.google.com",
      visitNumber: 2,
      gaClientId: "1234567890.1700000000",
      country: "IL",
      city: "Tel Aviv",
      deviceType: "mobile",
      os: "iOS",
      emailStatus: "SENT",
    });
    expect(rows[0].firstSeenAt?.toISOString()).toBe("2026-10-09T12:00:00.000Z");

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("This visit: google / organic");
    expect(sent[0].text).toContain("linkedin / social, campaign \"mental-load\"");
    expect(sent[0].text).toContain("/he/contact");
  });

  it("keeps the lead on record when the email fails", async () => {
    resendStatus = 500;
    const res = await POST(request({ name: "x", email: "x@example.com" }));
    expect(res.status).toBe(502);
    const rows = await prisma.websiteLead.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].emailStatus).toBe("FAILED");
  });

  it("accepts a request with no history, or a broken one, like before", async () => {
    expect((await POST(request({ name: "a", email: "a@example.com" }))).status).toBe(200);
    expect((await POST(request({ name: "b", email: "b@example.com", attribution: "garbage" }))).status).toBe(200);
    expect(
      (await POST(request({ name: "c", email: "c@example.com", attribution: { pages: [{ p: 1 }], visitNumber: "x" } }))).status
    ).toBe(200);
    const rows = await prisma.websiteLead.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === null && r.emailStatus === "SENT")).toBe(true);
    expect(sent[0].text).toContain("No visit history was sent");
  });

  it("never stores a query string beyond the campaign parameters", async () => {
    await POST(
      request({
        name: "q",
        email: "q@example.com",
        attribution: {
          sessionTouch: { at: "2026-10-11T06:58:00.000Z", landing: "/he?email=q@example.com&utm_source=x", referrer: "https://example.org/a?secret=1", utm: {}, clickIds: {} },
        },
      })
    );
    const [row] = await prisma.websiteLead.findMany();
    expect(row.landingPage).toBe("/he?utm_source=x");
    expect(row.referrer).toBe("https://example.org/a");
    expect(JSON.stringify(row.attribution)).not.toContain("secret");
    expect(JSON.stringify(row.attribution)).not.toContain("email=");
  });
});

describe("retention: 24 months, then gone", () => {
  it("deletes requests older than 24 months and keeps the rest", async () => {
    const { purgeExpiredWebsiteLeads } = await import("@/lib/website-leads");
    const now = new Date("2026-10-11T05:00:00Z");
    await prisma.websiteLead.createMany({
      data: [
        { name: "old", email: "old@example.com", createdAt: new Date("2024-10-10T23:00:00Z") },
        { name: "edge", email: "edge@example.com", createdAt: new Date("2024-10-11T06:00:00Z") },
        { name: "new", email: "new@example.com", createdAt: new Date("2026-10-01T00:00:00Z") },
      ],
    });
    expect(await purgeExpiredWebsiteLeads(now)).toEqual({ deleted: 1 });
    const left = (await prisma.websiteLead.findMany({ orderBy: { name: "asc" } })).map((r) => r.name);
    expect(left).toEqual(["edge", "new"]);
  });
});
