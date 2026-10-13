import { describe, it, expect } from "vitest";
import { emailDomain, normalizeDomain, normalizeEmail, normalizePhone, parseList } from "@/lib/contact-normalize";

// Org-brain spec 3.5 (13.10.2026): one person, however they were typed.

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail("  Shani.Halevi@Nextage.co.il ")).toBe("shani.halevi@nextage.co.il");
  });
  it("refuses what is not an address", () => {
    expect(normalizeEmail("shani")).toBeNull();
    expect(normalizeEmail("shani@nextage")).toBeNull();
  });
  it("gives the domain", () => {
    expect(emailDomain("Guy@Nux.ai")).toBe("nux.ai");
  });
});

describe("normalizeDomain", () => {
  it("strips scheme, www, @ and path", () => {
    expect(normalizeDomain("https://www.Nextage.co.il/about")).toBe("nextage.co.il");
    expect(normalizeDomain("@nux.ai")).toBe("nux.ai");
  });
  it("refuses a word", () => {
    expect(normalizeDomain("nextage")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("Israeli mobile in every spelling is the same number", () => {
    expect(normalizePhone("054-123-4567")).toBe("+972541234567");
    expect(normalizePhone("+972 54 123 4567")).toBe("+972541234567");
    expect(normalizePhone("00972541234567")).toBe("+972541234567");
    expect(normalizePhone("972541234567")).toBe("+972541234567");
  });
  it("Israeli landline", () => {
    expect(normalizePhone("03-1234567")).toBe("+97231234567");
  });
  it("a foreign number with + passes through", () => {
    expect(normalizePhone("+1 (206) 555-0100")).toBe("+12065550100");
  });
  it("too short is not a phone", () => {
    expect(normalizePhone("1234")).toBeNull();
  });
});

describe("parseList", () => {
  it("splits, normalizes, dedupes, and names the invalid ones", () => {
    const r = parseList("A@x.com, a@x.com; b@y.org\nnot-an-email", normalizeEmail);
    expect(r.values).toEqual(["a@x.com", "b@y.org"]);
    expect(r.invalid).toEqual(["not-an-email"]);
  });
});
