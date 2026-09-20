import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKEN_TTL_DAYS,
  MCP_TOKEN_PREFIX,
  defaultExpiry,
  generateMcpToken,
  hashMcpToken,
  looksLikeMcpToken,
  parseBearerToken,
} from "@/lib/mcp/token";

// Phase 13 (MCP server, docs/adr/0005). lib/mcp/token.ts is deliberately
// free of "server-only" and Prisma so it runs here directly - see the
// header comment on tests/unit/reports.test.ts for why most domain tests
// cannot.

describe("generateMcpToken()", () => {
  it("carries the scanner-matchable prefix", () => {
    expect(generateMcpToken().startsWith(MCP_TOKEN_PREFIX)).toBe(true);
  });

  it("produces a value its own validator accepts", () => {
    expect(looksLikeMcpToken(generateMcpToken())).toBe(true);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateMcpToken()));
    expect(seen.size).toBe(200);
  });
});

describe("hashMcpToken()", () => {
  it("is stable for the same input", () => {
    const token = generateMcpToken();
    expect(hashMcpToken(token)).toBe(hashMcpToken(token));
  });

  it("differs for different inputs", () => {
    expect(hashMcpToken(generateMcpToken())).not.toBe(hashMcpToken(generateMcpToken()));
  });

  it("never returns the raw token (the whole point of storing a hash)", () => {
    const token = generateMcpToken();
    const hash = hashMcpToken(token);
    expect(hash).not.toContain(token);
    expect(hash).not.toContain(token.slice(MCP_TOKEN_PREFIX.length));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("looksLikeMcpToken()", () => {
  it("rejects empty and nullish values", () => {
    expect(looksLikeMcpToken(null)).toBe(false);
    expect(looksLikeMcpToken(undefined)).toBe(false);
    expect(looksLikeMcpToken("")).toBe(false);
  });

  it("rejects a bare prefix with no secret", () => {
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX)).toBe(false);
  });

  it("rejects values without the prefix, even well-formed ones", () => {
    const body = generateMcpToken().slice(MCP_TOKEN_PREFIX.length);
    expect(looksLikeMcpToken(body)).toBe(false);
  });

  it("rejects a secret of the wrong length", () => {
    expect(looksLikeMcpToken(`${MCP_TOKEN_PREFIX}tooshort`)).toBe(false);
    expect(looksLikeMcpToken(`${MCP_TOKEN_PREFIX}${"a".repeat(44)}`)).toBe(false);
  });

  it("rejects characters outside base64url, so padding and slashes fail", () => {
    expect(looksLikeMcpToken(`${MCP_TOKEN_PREFIX}${"a".repeat(42)}=`)).toBe(false);
    expect(looksLikeMcpToken(`${MCP_TOKEN_PREFIX}${"a".repeat(42)}/`)).toBe(false);
  });
});

describe("parseBearerToken()", () => {
  it("extracts the credential from a well-formed header", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("tolerates the casing and spacing real clients send", () => {
    expect(parseBearerToken("bearer abc123")).toBe("abc123");
    expect(parseBearerToken("  BEARER   abc123  ")).toBe("abc123");
  });

  it("returns null for other schemes and for junk", () => {
    expect(parseBearerToken("Basic abc123")).toBeNull();
    expect(parseBearerToken("abc123")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it("does not silently accept two credentials", () => {
    expect(parseBearerToken("Bearer abc def")).toBeNull();
  });
});

describe("defaultExpiry()", () => {
  it("is the documented TTL ahead of the given instant", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = defaultExpiry(now);
    const days = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(DEFAULT_TOKEN_TTL_DAYS);
  });

  it("is always in the future - there is no never-expiring token", () => {
    expect(defaultExpiry().getTime()).toBeGreaterThan(Date.now());
  });
});
