import { describe, expect, it } from "vitest";
import { FACT_SECTIONS, FACT_KIND_LABELS, factShapeError, isPastValidity } from "@/lib/client-facts";

describe("factShapeError", () => {
  it("needs the words", () => {
    expect(factShapeError({ kind: "NOTE", body: "  " })).toContain("לכתוב");
    expect(factShapeError({ kind: "NOTE", body: "x" })).toBeNull();
  });

  it("a temporary fact needs an end: a date or an event", () => {
    expect(factShapeError({ kind: "TEMPORARY", body: "Anthropic בכרטיס הפרטי" })).toContain("תוקף");
    expect(factShapeError({ kind: "TEMPORARY", body: "x", validUntilEvent: "עד הצירוף לארגון" })).toBeNull();
    expect(factShapeError({ kind: "TEMPORARY", body: "x", validUntil: new Date("2026-12-01T00:00:00Z") })).toBeNull();
  });

  it("a one-off decision needs a date", () => {
    expect(factShapeError({ kind: "ONE_OFF_DECISION", body: "משתמש נפרד" })).toContain("תאריך");
    expect(factShapeError({ kind: "ONE_OFF_DECISION", body: "x", decidedAt: new Date("2026-10-09T00:00:00Z") })).toBeNull();
  });
});

describe("isPastValidity", () => {
  const now = new Date("2026-10-14T09:00:00Z");
  it("flags an open temporary fact whose date has passed, and nothing else", () => {
    expect(isPastValidity({ kind: "TEMPORARY", validUntil: new Date("2026-10-13T00:00:00Z"), closedAt: null }, now)).toBe(true);
    expect(isPastValidity({ kind: "TEMPORARY", validUntil: new Date("2026-10-15T00:00:00Z"), closedAt: null }, now)).toBe(false);
    expect(isPastValidity({ kind: "TEMPORARY", validUntil: new Date("2026-10-13T00:00:00Z"), closedAt: now }, now)).toBe(false);
    expect(isPastValidity({ kind: "TEMPORARY", validUntil: null, closedAt: null }, now)).toBe(false);
    expect(isPastValidity({ kind: "NOTE", validUntil: new Date("2026-10-13T00:00:00Z"), closedAt: null }, now)).toBe(false);
  });
});

describe("sections", () => {
  it("covers every kind once, with a label", () => {
    const kinds = FACT_SECTIONS.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual(Object.keys(FACT_KIND_LABELS).sort());
  });
});
