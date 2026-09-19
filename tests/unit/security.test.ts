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
