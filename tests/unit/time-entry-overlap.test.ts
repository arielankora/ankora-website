import { describe, expect, it } from "vitest";
import { resolveOverlapDecision, keepStoredIfSameMinute } from "@/lib/app-domain/time-entry-overlap";

// Phase 12 ("אישור דיווח שעות חופף בין לקוחות שונים"). Pure rule only - see
// lib/app-domain/time-entry-overlap.ts's header comment for why this is
// split out from lib/app-domain/time-entries.ts (which imports Prisma and
// so cannot be exercised in this sandbox).

describe("resolveOverlapDecision()", () => {
  it("blocks a same-client conflict for a non-privileged actor even when override is requested", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-a",
      allowOverride: true,
      hasEditOthersPermission: false,
    });
    expect(decision).toEqual({ allowed: false, confirmed: false, sameClient: true });
  });

  it("blocks a same-client conflict outright when no override was requested at all", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-a",
      allowOverride: false,
      hasEditOthersPermission: false,
    });
    expect(decision).toEqual({ allowed: false, confirmed: false, sameClient: true });
  });

  it("allows and flags a same-client conflict when an edit_others-privileged actor overrides (admin checkbox, unchanged behavior)", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-a",
      allowOverride: true,
      hasEditOthersPermission: true,
    });
    expect(decision).toEqual({ allowed: true, confirmed: true, sameClient: true });
  });

  it("does NOT allow a same-client conflict for a privileged actor who has not opted into override", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-a",
      allowOverride: false,
      hasEditOthersPermission: true,
    });
    expect(decision).toEqual({ allowed: false, confirmed: false, sameClient: true });
  });

  it("blocks a cross-client conflict until explicitly confirmed, with no error yet", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-b",
      allowOverride: false,
      hasEditOthersPermission: false,
    });
    expect(decision).toEqual({ allowed: false, confirmed: false, sameClient: false });
  });

  it("allows and flags a cross-client conflict for a self-service employee once confirmed - no edit_others required", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-b",
      allowOverride: true,
      hasEditOthersPermission: false,
    });
    expect(decision).toEqual({ allowed: true, confirmed: true, sameClient: false });
  });

  it("allows and flags a cross-client conflict for a privileged actor confirming too", () => {
    const decision = resolveOverlapDecision({
      conflictClientId: "client-a",
      newEntryClientId: "client-b",
      allowOverride: true,
      hasEditOthersPermission: true,
    });
    expect(decision).toEqual({ allowed: true, confirmed: true, sameClient: false });
  });
});

describe("keepStoredIfSameMinute()", () => {
  const stored = new Date("2026-09-14T08:54:50.240Z");

  it("treats a submitted time in the same minute as no change", () => {
    expect(keepStoredIfSameMinute(new Date("2026-09-14T08:54:00.000Z"), stored)).toBeUndefined();
  });

  it("passes through a time in a different minute", () => {
    const moved = new Date("2026-09-14T08:55:00.000Z");
    expect(keepStoredIfSameMinute(moved, stored)).toBe(moved);
  });

  it("passes through when nothing is stored (a running timer has no end)", () => {
    const end = new Date("2026-09-14T09:05:00.000Z");
    expect(keepStoredIfSameMinute(end, null)).toBe(end);
  });

  it("returns undefined when nothing was submitted", () => {
    expect(keepStoredIfSameMinute(undefined, stored)).toBeUndefined();
  });
});
