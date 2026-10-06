import { describe, expect, it } from "vitest";
import { normalizeValue } from "@/lib/app-domain/backup-dump";

// The credentials vault added the first bytea columns to the schema
// (6.10.2026). Prisma 6 returns them as a plain Uint8Array, which the dump
// used to recognise only as a Buffer. These pin both shapes, and a view
// into a larger buffer, which is where an offset bug would hide.
describe("normalizeValue, bytes", () => {
  const bytes = [0, 1, 2, 250, 255];
  const b64 = Buffer.from(bytes).toString("base64");

  it("encodes a Buffer", () => {
    expect(normalizeValue(Buffer.from(bytes))).toEqual({ __bytes_b64: b64 });
  });

  it("encodes a plain Uint8Array, as Prisma 6 returns bytea", () => {
    expect(normalizeValue(new Uint8Array(bytes))).toEqual({ __bytes_b64: b64 });
  });

  it("encodes only the view, not the whole underlying buffer", () => {
    const big = new Uint8Array([9, 9, ...bytes, 9]);
    expect(normalizeValue(big.subarray(2, 2 + bytes.length))).toEqual({ __bytes_b64: b64 });
  });

  it("round-trips through JSON to the same bytes", () => {
    const out = JSON.parse(JSON.stringify(normalizeValue(new Uint8Array(bytes)))) as { __bytes_b64: string };
    expect([...Buffer.from(out.__bytes_b64, "base64")]).toEqual(bytes);
  });
});
