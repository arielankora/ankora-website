import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { csvField, toCsv, neutralizeFormula } from "@/lib/csv";
import { rateLimit, clientIpFrom, __resetRateLimitsForTests } from "@/lib/rate-limit";

// Regression tests for the security review (OWASP Top 10 pass). Each
// block names the class of bug it exists to stop coming back.

describe("CSV/XLSX formula injection (OWASP A03 / CWE-1236)", () => {
  it("neutralizes every character a spreadsheet treats as a formula start", () => {
    for (const trigger of ["=", "+", "-", "@", "\t", "\r"]) {
      const value = `${trigger}HYPERLINK("https://evil.example")`;
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    }
  });

  it("neutralizes the classic DDE command-execution payload", () => {
    expect(csvField('=cmd|\'/c calc\'!A0')).toBe('\'=cmd|\'/c calc\'!A0');
  });

  it("leaves ordinary text untouched", () => {
    expect(neutralizeFormula("לקוח לדוגמה")).toBe("לקוח לדוגמה");
    expect(neutralizeFormula("Acme Ltd.")).toBe("Acme Ltd.");
  });

  it("never touches real numbers, so client-side sums keep working", () => {
    expect(neutralizeFormula(-42)).toBe(-42);
    expect(neutralizeFormula(0)).toBe(0);
    expect(csvField(-42)).toBe("-42");
  });

  it("still escapes RFC 4180 special characters after neutralizing", () => {
    expect(csvField('=a,b')).toBe('"\'=a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("keeps the UTF-8 BOM and CRLF line endings Excel needs for Hebrew", () => {
    const csv = toCsv(["שם"], [["=1+1"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("'=1+1");
  });
});

describe("rate limiting (OWASP A07 / API4)", () => {
  beforeEach(() => __resetRateLimitsForTests());
  afterEach(() => __resetRateLimitsForTests());

  it("allows up to the limit and blocks the attempt after it", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
    }
    expect(rateLimit("k", 3, 60_000).allowed).toBe(false);
  });

  it("reports a usable Retry-After", () => {
    rateLimit("k", 1, 60_000);
    const blocked = rateLimit("k", 1, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps separate namespaces from sharing a budget", () => {
    rateLimit("admin-login:1.2.3.4", 1, 60_000);
    expect(rateLimit("contact:1.2.3.4", 1, 60_000).allowed).toBe(true);
  });

  it("keeps separate callers from sharing a budget", () => {
    rateLimit("admin-login:1.2.3.4", 1, 60_000);
    expect(rateLimit("admin-login:5.6.7.8", 1, 60_000).allowed).toBe(true);
  });

  it("resets once the window has elapsed", async () => {
    expect(rateLimit("k", 1, 30).allowed).toBe(true);
    expect(rateLimit("k", 1, 30).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 45));
    expect(rateLimit("k", 1, 30).allowed).toBe(true);
  });

  it("takes the LEFTMOST x-forwarded-for entry, so a caller cannot spoof a fresh bucket", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" });
    expect(clientIpFrom(headers)).toBe("9.9.9.9");
  });

  it("prefers x-real-ip when Vercel sets it", () => {
    const headers = new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" });
    expect(clientIpFrom(headers)).toBe("9.9.9.9");
  });

  it("falls back to one shared bucket rather than silently disabling the limit", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("shared Redis rate limiting (lib/rate-limit-redis.ts)", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;
    __resetRateLimitsForTests();
  });

  async function loadRedis() {
    return import("@/lib/rate-limit-redis");
  }

  it("reports itself unconfigured when the env vars are absent", async () => {
    const { isRedisRateLimitConfigured } = await loadRedis();
    expect(isRedisRateLimitConfigured()).toBe(false);
  });

  it("returns null (no answer) when unconfigured, so callers fall back", async () => {
    const { redisRateLimit } = await loadRedis();
    expect(await redisRateLimit("k", 5, 60_000)).toBeNull();
  });

  it("never throws when Redis errors - it returns null so logins keep working", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    globalThis.fetch = (async () => {
      throw new Error("connection reset");
    }) as any;
    const { redisRateLimit } = await loadRedis();
    // The assertion that matters: this resolves rather than rejecting.
    await expect(redisRateLimit("k", 5, 60_000)).resolves.toBeNull();
  });

  it("returns null on a non-2xx response rather than treating it as a verdict", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as any;
    const { redisRateLimit } = await loadRedis();
    expect(await redisRateLimit("k", 5, 60_000)).toBeNull();
  });

  it("sends INCR plus EXPIRE..NX in one pipelined request", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    let seenUrl = "";
    let seenBody: any = null;
    let seenAuth = "";
    globalThis.fetch = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenAuth = init.headers.Authorization;
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
    }) as any;

    const { redisRateLimit } = await loadRedis();
    const r = await redisRateLimit("admin-login:1.2.3.4", 10, 60_000);

    expect(seenUrl).toBe("https://example.upstash.io/pipeline");
    expect(seenAuth).toBe("Bearer t");
    expect(seenBody[0][0]).toBe("INCR");
    expect(seenBody[1][0]).toBe("EXPIRE");
    // NX is what stops a sustained attack from pushing the expiry forward
    // on every request and keeping the window alive forever.
    expect(seenBody[1][3]).toBe("NX");
    expect(r).toMatchObject({ allowed: true, remaining: 9 });
  });

  it("blocks once the shared counter passes the limit", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ result: 11 }, { result: 0 }]), { status: 200 })) as any;
    const { redisRateLimit } = await loadRedis();
    const r = await redisRateLimit("k", 10, 60_000);
    expect(r?.allowed).toBe(false);
    expect(r?.remaining).toBe(0);
    expect(r?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("buckets the key by window so counters roll over instead of accumulating", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    const keys: string[] = [];
    globalThis.fetch = (async (_u: any, init: any) => {
      keys.push(JSON.parse(init.body)[0][1]);
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
    }) as any;
    const { redisRateLimit } = await loadRedis();
    await redisRateLimit("k", 5, 50);
    await new Promise((r) => setTimeout(r, 70));
    await redisRateLimit("k", 5, 50);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("checkRateLimit tier selection", () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;
    __resetRateLimitsForTests();
  });

  it("falls back to the in-memory counter when Redis gives no answer", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    // No Redis env vars -> redisRateLimit returns null -> in-memory applies.
    expect((await checkRateLimit("fallback", 2, 60_000)).allowed).toBe(true);
    expect((await checkRateLimit("fallback", 2, 60_000)).allowed).toBe(true);
    expect((await checkRateLimit("fallback", 2, 60_000)).allowed).toBe(false);
  });

  it("prefers the shared answer over the local one when Redis responds", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ result: 99 }, { result: 0 }]), { status: 200 })) as any;
    const { checkRateLimit } = await import("@/lib/rate-limit");
    // Local memory has seen nothing, but the shared counter says 99 > 3.
    expect((await checkRateLimit("shared-wins", 3, 60_000)).allowed).toBe(false);
  });
});

describe("Upstash env var naming (regression: Vercel injects KV_*, not UPSTASH_*)", () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const k of [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
      "KV_REST_API_READ_ONLY_TOKEN",
    ]) delete process.env[k];
    __resetRateLimitsForTests();
  });

  // This is the case that actually shipped: Vercel's Upstash Marketplace
  // integration injects KV_REST_API_* and nothing else. Reading only the
  // UPSTASH_* pair meant the limiter silently stayed in-memory.
  it("works with ONLY the KV_* pair that Vercel's integration injects", async () => {
    process.env.KV_REST_API_URL = "https://kv.upstash.io";
    process.env.KV_REST_API_TOKEN = "kv-token";
    const { isRedisRateLimitConfigured, redisRateLimit } = await import("@/lib/rate-limit-redis");
    expect(isRedisRateLimitConfigured()).toBe(true);

    let seenUrl = "", seenAuth = "";
    globalThis.fetch = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenAuth = init.headers.Authorization;
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
    }) as any;

    const r = await redisRateLimit("k", 10, 60_000);
    expect(seenUrl).toBe("https://kv.upstash.io/pipeline");
    expect(seenAuth).toBe("Bearer kv-token");
    expect(r?.allowed).toBe(true);
  });

  it("works with ONLY the UPSTASH_* pair (provisioned straight from Upstash)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://direct.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "direct-token";
    const { isRedisRateLimitConfigured } = await import("@/lib/rate-limit-redis");
    expect(isRedisRateLimitConfigured()).toBe(true);
  });

  it("prefers an explicitly set UPSTASH_* pair over the integration's KV_*", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://explicit.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "explicit-token";
    process.env.KV_REST_API_URL = "https://integration.upstash.io";
    process.env.KV_REST_API_TOKEN = "integration-token";
    let seenUrl = "", seenAuth = "";
    globalThis.fetch = (async (url: any, init: any) => {
      seenUrl = String(url);
      seenAuth = init.headers.Authorization;
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
    }) as any;
    const { redisRateLimit } = await import("@/lib/rate-limit-redis");
    await redisRateLimit("k", 10, 60_000);
    expect(seenUrl).toBe("https://explicit.upstash.io/pipeline");
    expect(seenAuth).toBe("Bearer explicit-token");
  });

  it("never uses the READ-ONLY token - INCR is a write", async () => {
    process.env.KV_REST_API_URL = "https://kv.upstash.io";
    process.env.KV_REST_API_READ_ONLY_TOKEN = "read-only-token";
    const { isRedisRateLimitConfigured } = await import("@/lib/rate-limit-redis");
    // A read-only token alone must NOT count as configured.
    expect(isRedisRateLimitConfigured()).toBe(false);

    process.env.KV_REST_API_TOKEN = "write-token";
    let seenAuth = "";
    globalThis.fetch = (async (_u: any, init: any) => {
      seenAuth = init.headers.Authorization;
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
    }) as any;
    const { redisRateLimit } = await import("@/lib/rate-limit-redis");
    await redisRateLimit("k", 10, 60_000);
    expect(seenAuth).toBe("Bearer write-token");
    expect(seenAuth).not.toContain("read-only");
  });

  it("a half-configured pair does not count as configured", async () => {
    process.env.KV_REST_API_URL = "https://kv.upstash.io";
    const { isRedisRateLimitConfigured } = await import("@/lib/rate-limit-redis");
    expect(isRedisRateLimitConfigured()).toBe(false);
  });
});
