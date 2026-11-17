import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Way 3 (17.11.2026): /api/claude-limits is a public URL every employee's
// browser posts to. It must refuse anyone without the shared secret, keep
// to small JSON, and store only a sane reading.

const ingest = vi.hoisted(() => ({ ingestLimitReading: vi.fn(async (_r: unknown) => ({ matched: true })) }));
vi.mock("@/lib/claude-usage/cowork-ingest", () => ingest);
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: vi.fn(async () => null) }));

const route = await import("@/app/api/claude-limits/route");

const SECRET = "limits-secret-0123456789abcdef";
const ORIGINAL = process.env.CLAUDE_LIMITS_SECRET;

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://ankora.test/api/claude-limits", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", ...headers }, body });

const reading = JSON.stringify({ email: "hadas@ankora.co.il", fiveHour: { pct: 42 }, sevenDay: { pct: 70 }, version: "1.0.0" });

describe("POST /api/claude-limits", () => {
  beforeEach(() => {
    process.env.CLAUDE_LIMITS_SECRET = SECRET;
    ingest.ingestLimitReading.mockClear();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CLAUDE_LIMITS_SECRET;
    else process.env.CLAUDE_LIMITS_SECRET = ORIGINAL;
  });

  it("refuses a wrong or missing secret and stores nothing", async () => {
    expect((await route.POST(post(reading, { authorization: "Bearer nope" }))).status).toBe(401);
    expect((await route.POST(new Request("https://ankora.test/api/claude-limits", { method: "POST", body: reading }))).status).toBe(401);
    expect(ingest.ingestLimitReading).not.toHaveBeenCalled();
  });

  it("says it is not configured while the secret is unset", async () => {
    delete process.env.CLAUDE_LIMITS_SECRET;
    expect((await route.POST(post(reading))).status).toBe(503);
  });

  it("stores a sane reading and says whether the email matched a person", async () => {
    const res = await route.POST(post(reading));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matched: true });
    expect(ingest.ingestLimitReading.mock.calls[0][0]).toMatchObject({ email: "hadas@ankora.co.il", fiveHourPct: 42, sevenDayPct: 70 });
  });

  it("refuses a body that is too large, not JSON, or not a reading", async () => {
    expect((await route.POST(post("x".repeat(9000)))).status).toBe(413);
    expect((await route.POST(post("not json"))).status).toBe(400);
    expect((await route.POST(post(JSON.stringify({ email: "a@b.co" })))).status).toBe(400);
    expect(ingest.ingestLimitReading).not.toHaveBeenCalled();
  });
});
