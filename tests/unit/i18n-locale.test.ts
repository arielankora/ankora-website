import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/app-auth/session", () => ({ getCurrentUser: async () => null }));

import { APP_LOCALES, DEFAULT_APP_LOCALE, directionOf, intlTag, isAppLocale } from "@/lib/i18n/config";
import { pickLocale, safeTimeZone } from "@/lib/i18n/resolve";

describe("app locales (ADR 0006)", () => {
  it("are Hebrew and English, Hebrew by default", () => {
    expect([...APP_LOCALES]).toEqual(["he", "en"]);
    expect(DEFAULT_APP_LOCALE).toBe("he");
  });

  it("accept only their own values", () => {
    expect(isAppLocale("he")).toBe(true);
    expect(isAppLocale("en")).toBe(true);
    for (const bad of ["EN", "en-US", "fr", "", null, undefined, 1]) expect(isAppLocale(bad)).toBe(false);
  });

  it("map to a direction and an Intl tag", () => {
    expect(directionOf("he")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    expect(intlTag("he")).toBe("he-IL");
    expect(intlTag("en")).toBe("en-IL");
  });

  it("format English dates day first, in 24 hours, the way the Hebrew screens do", () => {
    const at = new Date("2026-03-04T15:05:00Z");
    const text = new Intl.DateTimeFormat(intlTag("en"), { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(at);
    expect(text).toMatch(/^04\/03\/2026/);
    expect(text).toMatch(/17:05/);
  });
});

describe("which locale a request is rendered in", () => {
  it("follows the signed-in person's choice over the browser's cookie", () => {
    expect(pickLocale("en", "he")).toBe("en");
    expect(pickLocale("he", "en")).toBe("he");
  });

  it("falls back to the cookie when nobody is signed in", () => {
    expect(pickLocale(null, "en")).toBe("en");
  });

  it("ignores a cookie that is not one of our locales", () => {
    expect(pickLocale(null, "fr")).toBe("he");
    expect(pickLocale(undefined, "<script>")).toBe("he");
    expect(pickLocale(undefined, undefined)).toBe("he");
  });
});

describe("the time zone dates are formatted in", () => {
  it("is the person's own when Intl knows it", () => {
    expect(safeTimeZone("Europe/London")).toBe("Europe/London");
  });

  it("falls back to Jerusalem for a value Intl rejects, or none", () => {
    expect(safeTimeZone("Not/AZone")).toBe("Asia/Jerusalem");
    expect(safeTimeZone("")).toBe("Asia/Jerusalem");
    expect(safeTimeZone(null)).toBe("Asia/Jerusalem");
  });
});
