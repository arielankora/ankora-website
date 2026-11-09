import { describe, expect, it } from "vitest";
import { toCountryCode, toCurrencyCode } from "@/lib/iso-codes";

describe("toCountryCode", () => {
  it("turns a country name in Hebrew or English into its code", () => {
    expect(toCountryCode("ישראל")).toBe("IL");
    expect(toCountryCode(" Israel ")).toBe("IL");
    expect(toCountryCode("ארצות הברית")).toBe("US");
    expect(toCountryCode('ארה"ב')).toBe("US");
    expect(toCountryCode("USA")).toBe("US");
    expect(toCountryCode("בריטניה")).toBe("GB");
    expect(toCountryCode("il")).toBe("IL");
  });

  it("leaves what it does not know as written, and empty as null", () => {
    expect(toCountryCode("Atlantis")).toBe("Atlantis");
    expect(toCountryCode("  ")).toBeNull();
    expect(toCountryCode(null)).toBeNull();
  });
});

describe("toCurrencyCode", () => {
  it("turns a currency name or sign into its code", () => {
    expect(toCurrencyCode('ש"ח')).toBe("ILS");
    expect(toCurrencyCode("שקל חדש")).toBe("ILS");
    expect(toCurrencyCode("₪")).toBe("ILS");
    expect(toCurrencyCode("NIS")).toBe("ILS");
    expect(toCurrencyCode("דולר")).toBe("USD");
    expect(toCurrencyCode("usd")).toBe("USD");
    expect(toCurrencyCode("אירו")).toBe("EUR");
  });

  it("leaves what it does not know as written", () => {
    expect(toCurrencyCode("זהובים")).toBe("זהובים");
    expect(toCurrencyCode(undefined)).toBeNull();
  });
});
