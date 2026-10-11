// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The browser half: what a visit looks like by the time the form reads it.
// The module keeps "this document's arrival was recorded" in module state,
// so each test loads a fresh copy.

async function fresh() {
  vi.resetModules();
  return import("@/lib/attribution-client");
}

function at(href: string, referrer = "") {
  window.history.replaceState(null, "", href);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

describe("recordPageView / readAttribution", () => {
  it("records the arrival and every page of the visit, client navigations included", async () => {
    const m = await fresh();
    at("/he/pricing?utm_source=linkedin&utm_medium=social&email=x@y.co", "https://www.linkedin.com/feed/");
    m.recordPageView(new Date("2026-10-11T06:58:00Z"));
    at("/he/contact");
    m.recordPageView(new Date("2026-10-11T07:01:00Z"));

    const a = m.readAttribution();
    expect(a.visitNumber).toBe(1);
    expect(a.sessionTouch?.utm).toEqual({ utm_source: "linkedin", utm_medium: "social" });
    expect(a.sessionTouch?.referrer).toBe("https://www.linkedin.com/feed/");
    expect(a.sessionTouch?.landing).toBe("/he/pricing?utm_source=linkedin&utm_medium=social");
    expect(a.pages?.map((p) => p.p)).toEqual(["/he/pricing?utm_source=linkedin&utm_medium=social", "/he/contact"]);
    expect(a.firstTouch).toEqual(a.sessionTouch);
  });

  it("a return after 30 idle minutes is visit 2, and the first visit is kept", async () => {
    let m = await fresh();
    at("/he", "https://www.google.com/");
    m.recordPageView(new Date("2026-10-09T12:00:00Z"));

    m = await fresh(); // a new page load, two days later
    at("/he/contact");
    m.recordPageView(new Date("2026-10-11T07:00:00Z"));

    const a = m.readAttribution();
    expect(a.visitNumber).toBe(2);
    expect(a.firstTouch?.referrer).toBe("https://www.google.com");
    expect(a.sessionTouch?.referrer).toBe("");
    expect(a.pages?.map((p) => p.p)).toEqual(["/he/contact"]);
  });

  it("a new campaign click inside the idle window still starts a new visit", async () => {
    let m = await fresh();
    at("/he");
    m.recordPageView(new Date("2026-10-11T07:00:00Z"));
    m = await fresh();
    at("/he?gclid=abc");
    m.recordPageView(new Date("2026-10-11T07:05:00Z"));
    expect(m.readAttribution().visitNumber).toBe(2);
  });

  it("carries the GA4 client id from the _ga cookie", async () => {
    const m = await fresh();
    document.cookie = "_ga=GA1.1.1234567890.1700000000";
    expect(m.readAttribution().gaClientId).toBe("1234567890.1700000000");
  });

  it("does nothing, and throws nothing, when storage is blocked", async () => {
    const m = await fresh();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => m.recordPageView()).not.toThrow();
    expect(m.readAttribution().sessionTouch).toBeUndefined();
    spy.mockRestore();
  });
});
