import { describe, expect, it } from "vitest";
import { clientNameMatches } from "@/lib/client-search";

describe("clientNameMatches (clients screen search)", () => {
  it("finds a Latin name whatever the case typed", () => {
    for (const q of ["g", "G", "gra", "GRA", "Grantor", "grantor", "GRANTOR", "gRaNtOr"]) {
      expect(clientNameMatches("Grantor", q)).toBe(true);
    }
  });

  it("matches the inside of a name, in any case", () => {
    expect(clientNameMatches("Grantor Ltd", "ltd")).toBe(true);
    expect(clientNameMatches("Ankora פנימי", "ankora")).toBe(true);
  });

  it("matches Hebrew exactly as before", () => {
    expect(clientNameMatches('[DEMO] חברת אורביט בע"מ', "אורביט")).toBe(true);
    expect(clientNameMatches("Ankora פנימי", "פנימי")).toBe(true);
    expect(clientNameMatches('[DEMO] חברת אורביט בע"מ', "מרידיאן")).toBe(false);
  });

  it("ignores surrounding spaces and treats an empty query as no filter", () => {
    expect(clientNameMatches("Grantor", "  g  ")).toBe(true);
    expect(clientNameMatches("Grantor", "")).toBe(true);
    expect(clientNameMatches("Grantor", "   ")).toBe(true);
  });

  it("does not match what is not there", () => {
    expect(clientNameMatches("Grantor", "x")).toBe(false);
    expect(clientNameMatches("Grantor", "grantorx")).toBe(false);
  });
});
