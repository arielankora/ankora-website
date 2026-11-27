import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stage 2 of "התיבות שלי" (27.11.2026): /api/cron/mail-waits sends due
// reminders and drops sent emails nobody followed. A public URL, so it
// must check CRON_SECRET before it touches anything.

const waits = vi.hoisted(() => ({ sweepMailWaits: vi.fn(async () => ({ reminded: 2, closed: 1, dropped: 4 })) }));
vi.mock("@/lib/mail-scan/waits", () => waits);

// The run log and the issue table (lib/cron-run.ts) are not under test here.
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: vi.fn(async () => ({ id: "run" })), update: vi.fn(async () => ({})) } } }));
vi.mock("@/lib/system-issues", () => ({ reportIssue: vi.fn(), resolveIssue: vi.fn(), describeError: (e: unknown) => String(e) }));

const route = await import("@/app/api/cron/mail-waits/route");

const SECRET = "s3cr3t-cron-value-0123456789";
const ORIGINAL = process.env.CRON_SECRET;

function req(authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("https://ankora.test/api/cron/mail-waits", { headers });
}

describe("mail-waits cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    waits.sweepMailWaits.mockClear();
  });
  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
  });

  it("refuses without the secret and does nothing", async () => {
    const res = await route.GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(waits.sweepMailWaits).not.toHaveBeenCalled();
  });

  it("sweeps with the secret and says what it did", async () => {
    const res = await route.GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reminded: 2, closed: 1, dropped: 4 });
    expect(waits.sweepMailWaits).toHaveBeenCalledOnce();
  });
});
