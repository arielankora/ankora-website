import { describe, it, expect } from "vitest";
import { emailDomain, normalizeDomain, normalizeEmail, normalizePhone, normalizePhones, parseList, splitPhones } from "@/lib/contact-normalize";

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

describe("a number however it is written (27.11.2026)", () => {
  const SAME = [
    "052-1234567", "0521234567", "052 123 4567", "052-123-4567", "(052) 1234567", "0521-234567",
    "+972-52-1234567", "+972 52 123 4567", "+972521234567", "972521234567", "00972521234567", "00972-52-1234567",
    "+972 (0)52-1234567", "+972-052-1234567", "972-052-1234567", "+9720521234567", "00972-052-1234567",
    "52-1234567", "521234567",
    "נייד: 052-1234567", "Mobile: +972 52 123 4567", "tel:+972521234567",
    "052-1234567 / 03-1234567", "052-1234567 ext. 12", "052-1234567 שלוחה 3", "052-1234567 או 03-1234567",
  ];
  it.each(SAME)("%s is +972521234567", (raw) => {
    expect(normalizePhone(raw)).toBe("+972521234567");
  });

  it("keeps landlines, numbers abroad and their own zeros", () => {
    expect(normalizePhone("03-1234567")).toBe("+97231234567");
    expect(normalizePhone("+972-3-1234567")).toBe("+97231234567");
    expect(normalizePhone("+44 (0)20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizePhone("Fax: 03-1234567")).toBe("+97231234567");
    expect(normalizePhone("*2345")).toBeNull();
  });

  // 27.11.2026: four contacts of one client stored as "0974 4422 ....":
  // Qatar written with one 0 instead of 00.
  it("reads one 0 before a code from 970 to 979 as the international prefix", () => {
    expect(normalizePhone("0974 4422 1234")).toBe("+97444221234");
    expect(normalizePhone("097444221234")).toBe("+97444221234");
    expect(normalizePhone("0971 50 123 4567")).toBe("+971501234567");
    expect(normalizePhone("0972 52 123 4567")).toBe("+972521234567");
    expect(normalizePhone("0972 052 123 4567")).toBe("+972521234567");
    // An Israeli number from 09-7 is left Israeli, with or without the zero.
    expect(normalizePhone("09-7123456")).toBe("+97297123456");
    expect(normalizePhone("097123456")).toBe("+97297123456");
  });

  it("splits a field with several numbers, and stores each once", () => {
    expect(splitPhones("052-1234567 / 03-1234567")).toEqual(["052-1234567", "03-1234567"]);
    expect(splitPhones("052-1234567\n03-1234567; 054-7654321")).toEqual(["052-1234567", "03-1234567", "054-7654321"]);
    expect(normalizePhones(["052-1234567 / 03-1234567", "+972 52 123 4567", "054-7654321 או 1234"])).toEqual([
      "+972521234567",
      "+97231234567",
      "+972547654321",
    ]);
  });
});
