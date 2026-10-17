import { describe, expect, it } from "vitest";
import {
  batchMatches,
  batchUrgent,
  facetCounts,
  narrowsItems,
  needsAttention,
  parseReviewFilters,
  proposalKindKey,
  proposalKindLabel,
  proposalMatches,
  reviewFiltersHref,
} from "@/lib/knowledge-review-filters";

// Filters on "ממתין לאישור" (claude/knowledge-review-filters-spec-2026-10-17.md).

const none = parseReviewFilters({});
const p = (over: Partial<Parameters<typeof proposalMatches>[0]> = {}) => ({
  target: "FACT" as const,
  action: "CREATE" as const,
  state: "PENDING",
  flags: [],
  payload: { kind: "FINANCE" } as Record<string, unknown>,
  hiddenFor: null,
  ...over,
});

describe("review filters", () => {
  it("reads the URL and ignores what it does not know", () => {
    expect(parseReviewFilters({ clientId: " c1 ", kind: ["FACT.FINANCE", "CONTACT", "CONTACT"], attention: "1", age: "7" })).toEqual({
      clientId: "c1",
      kinds: ["FACT.FINANCE", "CONTACT"],
      attention: true,
      source: null,
      by: null,
      age: 7,
    });
    expect(parseReviewFilters({ age: "5", attention: "yes", clientId: "" })).toEqual(none);
  });

  it("writes back the same URL it reads", () => {
    const f = parseReviewFilters({ clientId: "c1", kind: ["FACT.FINANCE", "SYSTEM"], attention: "1", source: "TRANSCRIPT", by: "u1", age: "3" });
    const href = reviewFiltersHref(f);
    expect(parseReviewFilters(Object.fromEntries([...new URLSearchParams(href.split("?")[1]).keys()].map((k) => [k, new URLSearchParams(href.split("?")[1]).getAll(k)])))).toEqual(f);
    expect(reviewFiltersHref(none)).toBe("/app/knowledge");
  });

  it("names a fact by its kind and everything else by what it is", () => {
    expect(proposalKindKey(p())).toBe("FACT.FINANCE");
    expect(proposalKindLabel("FACT.FINANCE")).toBe("כספים");
    expect(proposalKindKey(p({ target: "CONTACT", payload: {} }))).toBe("CONTACT");
    expect(proposalKindLabel("CONTACT")).toBe("איש קשר");
    expect(proposalKindKey(p({ payload: { kind: "NOPE" } }))).toBe("FACT");
  });

  it("needs attention: sensitive, a change, a possible duplicate, any flag, or hidden from me", () => {
    expect(needsAttention(p())).toBe(false);
    expect(needsAttention(p({ action: "SUPERSEDE" }))).toBe(true);
    expect(needsAttention(p({ flags: [{ code: "DUPLICATE", message: "" }] }))).toBe(true);
    expect(needsAttention(p({ flags: [{ code: "R14", message: "" }] }))).toBe(true);
    expect(needsAttention(p({ payload: { kind: "NOTE", sensitivity: "SENSITIVE" } }))).toBe(true);
    expect(needsAttention(p({ hiddenFor: "הדס" }))).toBe(true);
  });

  it("kinds are OR, everything else AND", () => {
    const f = parseReviewFilters({ kind: ["FACT.FINANCE", "CONTACT"] });
    expect(proposalMatches(p(), f)).toBe(true);
    expect(proposalMatches(p({ target: "CONTACT", payload: {} }), f)).toBe(true);
    expect(proposalMatches(p({ payload: { kind: "NOTE" } }), f)).toBe(false);
    expect(proposalMatches(p(), { ...f, attention: true })).toBe(false);
  });

  it("decided rows show only when nothing narrows the items", () => {
    expect(proposalMatches(p({ state: "APPROVED" }), none)).toBe(true);
    expect(proposalMatches(p({ state: "APPROVED" }), parseReviewFilters({ clientId: "c1" }))).toBe(true);
    expect(narrowsItems(parseReviewFilters({ clientId: "c1" }))).toBe(false);
    expect(proposalMatches(p({ state: "APPROVED" }), parseReviewFilters({ attention: "1" }))).toBe(false);
  });

  it("filters batches by client, source, sender and age", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const b = { clientId: "c1", sourceKind: "TRANSCRIPT", createdById: "u1", createdAt: new Date("2026-10-13T12:00:00Z") };
    expect(batchMatches(b, none, now)).toBe(true);
    expect(batchMatches(b, parseReviewFilters({ clientId: "c2" }), now)).toBe(false);
    expect(batchMatches(b, parseReviewFilters({ source: "CLIENT_DOCUMENT" }), now)).toBe(false);
    expect(batchMatches(b, parseReviewFilters({ by: "u2" }), now)).toBe(false);
    expect(batchMatches(b, parseReviewFilters({ age: "3" }), now)).toBe(true);
    expect(batchMatches(b, parseReviewFilters({ age: "7" }), now)).toBe(false);
  });

  it("a batch with something to look at, or a temporary fact, comes first", () => {
    expect(batchUrgent([p()])).toBe(false);
    expect(batchUrgent([p(), p({ payload: { kind: "TEMPORARY" } })])).toBe(true);
    expect(batchUrgent([p({ action: "CONTRADICT", state: "REJECTED" })])).toBe(false);
  });

  it("each facet counts with every other filter applied, never its own", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const at = new Date("2026-10-16T12:00:00Z");
    const items = [
      { batch: { clientId: "a", sourceKind: "TRANSCRIPT", createdById: "u1", createdAt: at }, proposals: [p(), p(), p({ target: "CONTACT", payload: {} }), p({ state: "APPROVED" })] },
      { batch: { clientId: "b", sourceKind: "CLIENT_DOCUMENT", createdById: "u2", createdAt: at }, proposals: [p(), p({ action: "SUPERSEDE" })] },
    ];
    const byClient = facetCounts(items, parseReviewFilters({ clientId: "a" }), now);
    expect(byClient.kinds.get("FACT.FINANCE")).toBe(2);
    expect(byClient.kinds.get("CONTACT")).toBe(1);
    expect(byClient.clients.get("b"), "the client facet ignores the chosen client").toBe(2);
    expect(byClient.attention).toBe(0);
    expect(byClient.sources.get("CLIENT_DOCUMENT")).toBeUndefined();

    const byKind = facetCounts(items, parseReviewFilters({ kind: "CONTACT" }), now);
    expect(byKind.clients.get("a")).toBe(1);
    expect(byKind.clients.get("b")).toBeUndefined();
    expect(byKind.kinds.get("FACT.FINANCE"), "the kind facet ignores the chosen kind").toBe(4);
    expect(facetCounts(items, parseReviewFilters({ attention: "1" }), now).clients.get("b")).toBe(1);
  });
});
