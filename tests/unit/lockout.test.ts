import { describe, expect, it } from "vitest";
import { isLockedOut } from "@/lib/app-auth/lockout";

describe("isLockedOut()", () => {
  it("is false when lockedUntil is null", () => {
    expect(isLockedOut({ lockedUntil: null })).toBe(false);
  });

  it("is true when lockedUntil is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isLockedOut({ lockedUntil: future })).toBe(true);
  });

  it("is false when lockedUntil is in the past", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isLockedOut({ lockedUntil: past })).toBe(false);
  });
});
