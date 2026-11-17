import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Claude usage measurement (17.11.2026): /api/cron/claude-usage-retention
// deletes measurements past their retention. Like every cron route it is a
// public URL, so it must check CRON_SECRET before it deletes anything.

const record = vi.hoisted(() => ({ pruneClaudeUsage: vi.fn(async () => ({ toolCalls: 3, promptCopies: 1, coworkEvents: 2, limitSamples: 0 })) }));
vi.mock("@/lib/claude-usage/record", () => record);

const route = await import("@/app/api/cron/claude-usage-retention/route");

const SECRET = "s3cr3t-cron-value-0123456789";
const ORIGINAL = process.env.CRON_SECRET;

function req(authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("https://ankora.test/api/cron/claude-usage-retention", { headers });
}

describe("claude-usage-retention cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    record.pruneClaudeUsage.mockClear();
  });
  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
  });

  it("refuses without the secret and deletes nothing", async () => {
    const res = await route.GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(record.pruneClaudeUsage).not.toHaveBeenCalled();
  });

  it("prunes with the secret and says how many rows went", async () => {
    const res = await route.GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, toolCalls: 3, promptCopies: 1, coworkEvents: 2, limitSamples: 0 });
    expect(record.pruneClaudeUsage).toHaveBeenCalledOnce();
  });
});
