import { describe, expect, it } from "vitest";
import { CLIENTS_LIST_KEYS, IMPORTANT_DATES_LIST_KEYS, listBackHref, listQueryOf, withFrom } from "@/lib/list-back";

describe("list-back", () => {
  it("round-trips a list's own keys", () => {
    const q = listQueryOf({ q: "כהן", junk: "x" }, CLIENTS_LIST_KEYS);
    expect(q).toBe(new URLSearchParams({ q: "כהן" }).toString());
    const href = withFrom("/app/clients/abc", q);
    const from = new URL(href, "https://x.test").searchParams.get("from");
    expect(listBackHref("/app/clients", CLIENTS_LIST_KEYS, from)).toBe(`/app/clients?${q}`);
  });

  it("falls back to the list's defaults", () => {
    expect(listBackHref("/app/clients", CLIENTS_LIST_KEYS, undefined)).toBe("/app/clients");
    expect(listBackHref("/app/clients", CLIENTS_LIST_KEYS, ["q=a", "q=b"])).toBe("/app/clients");
    expect(listBackHref("/app/important-dates", IMPORTANT_DATES_LIST_KEYS, "evil=1")).toBe("/app/important-dates");
    expect(withFrom("/app/clients/abc", "")).toBe("/app/clients/abc");
  });

  it("never leaves the list's base and bounds values", () => {
    expect(listBackHref("/app/clients", CLIENTS_LIST_KEYS, "https://evil.test/?q=1")).toBe("/app/clients");
    expect(listBackHref("/app/clients", CLIENTS_LIST_KEYS, `q=${"a".repeat(201)}`)).toBe("/app/clients");
    expect(listBackHref("/app/important-dates", IMPORTANT_DATES_LIST_KEYS, "tab=done")).toBe("/app/important-dates?tab=done");
  });
});
