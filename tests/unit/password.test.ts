import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, validatePasswordPolicy, PASSWORD_MIN_LENGTH } from "@/lib/app-auth/password";

describe("password policy", () => {
  it("rejects passwords shorter than the minimum length", () => {
    const result = validatePasswordPolicy("short1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("rejects common weak passwords even if long enough", () => {
    const result = validatePasswordPolicy("password1");
    expect(result.valid).toBe(false);
  });

  it("is case-insensitive when matching the weak-password list", () => {
    const result = validatePasswordPolicy("PaSsWoRd1");
    expect(result.valid).toBe(false);
  });

  it("accepts a sufficiently long, non-common password", () => {
    const result = validatePasswordPolicy("Tr0ub4dor&Zebra");
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts a password exactly at the minimum length", () => {
    const result = validatePasswordPolicy("Xk8#mQ2!wZ"); // 10 chars, not in the weak list
    expect(result.valid).toBe(true);
  });
});

describe("password hashing", () => {
  it("hashes and verifies a matching password", async () => {
    const hash = await hashPassword("Tr0ub4dor&Zebra");
    expect(hash).not.toEqual("Tr0ub4dor&Zebra");
    await expect(verifyPassword("Tr0ub4dor&Zebra", hash)).resolves.toBe(true);
  });

  it("rejects a non-matching password against a real hash", async () => {
    const hash = await hashPassword("Tr0ub4dor&Zebra");
    await expect(verifyPassword("wrong-password-here", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    const [a, b] = await Promise.all([hashPassword("Tr0ub4dor&Zebra"), hashPassword("Tr0ub4dor&Zebra")]);
    expect(a).not.toEqual(b);
  });
});
