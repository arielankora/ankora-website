import { describe, expect, it } from "vitest";
import {
  AUTO_REVIEW_SAMPLE_PERCENT,
  autoDecisionBlocker,
  autoErrorAt,
  autoReviewReason,
  clientPauseDue,
  idBucket,
  inAutoSample,
  kindPauseDue,
  liftBarMet,
  needsAutoReview,
  wilsonLower,
} from "@/lib/auto-apply";

// Auto-apply of proposals (3.11.2026, approval tiers part 2): the rules
// that keep it safe, with no database. Under test:
//
//   1. The sample is fixed by the proposal's id, and about 20%.
//   2. Every item is looked at in the first 14 days and in the 7 days
//      after a guide approval; after that, only the sample.
//   3. An error is a revert, or a change to the item within 30 days.
//   4. A kind pauses at 3 errors in its last 30, counted after the latest
//      guide approval or lift; a client at 2 errors within 14 days.
//   5. The bar beside "להחזיר": 30 decisions, a lower bound of 85%.

const D = (s: string) => new Date(s);
const DAY = 86_400_000;

describe("the sample", () => {
  it("is the same for the same id, every time", () => {
    expect(idBucket("cm123abc")).toBe(idBucket("cm123abc"));
    expect(inAutoSample("cm123abc")).toBe(inAutoSample("cm123abc"));
  });

  it("takes about one in five", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `cmx${i.toString(36)}q${(i * 7919).toString(36)}`);
    const share = ids.filter(inAutoSample).length / ids.length;
    expect(share).toBeGreaterThan(AUTO_REVIEW_SAMPLE_PERCENT / 100 - 0.03);
    expect(share).toBeLessThan(AUTO_REVIEW_SAMPLE_PERCENT / 100 + 0.03);
  });
});

describe("which auto-applied items a person looks at", () => {
  const first = D("2026-11-03T12:00:00Z");
  const sampled = Array.from({ length: 200 }, (_, i) => `id${i}`).find(inAutoSample)!;
  const notSampled = Array.from({ length: 200 }, (_, i) => `id${i}`).find((id) => !inAutoSample(id))!;
  const ctx = { firstEnabledAt: first, guideApprovals: [] as Date[] };

  it("every one in the first 14 days", () => {
    expect(needsAutoReview({ id: notSampled, decidedAt: new Date(first.getTime() + 13 * DAY) }, ctx)).toBe(true);
    expect(autoReviewReason({ id: notSampled, decidedAt: first }, ctx)).toContain("14");
  });

  it("only the sample after them", () => {
    const later = new Date(first.getTime() + 15 * DAY);
    expect(needsAutoReview({ id: notSampled, decidedAt: later }, ctx)).toBe(false);
    expect(needsAutoReview({ id: sampled, decidedAt: later }, ctx)).toBe(true);
    expect(autoReviewReason({ id: sampled, decidedAt: later }, ctx)).toBe("מדגם של 20%");
    expect(autoReviewReason({ id: notSampled, decidedAt: later }, ctx)).toBeNull();
  });

  it("every one again for 7 days after a new guide version is approved", () => {
    const guide = new Date(first.getTime() + 30 * DAY);
    const g = { ...ctx, guideApprovals: [guide] };
    expect(needsAutoReview({ id: notSampled, decidedAt: new Date(guide.getTime() + 6 * DAY) }, g)).toBe(true);
    expect(needsAutoReview({ id: notSampled, decidedAt: new Date(guide.getTime() + 8 * DAY) }, g)).toBe(false);
    expect(needsAutoReview({ id: notSampled, decidedAt: new Date(guide.getTime() - DAY) }, g)).toBe(false);
  });

  it("every one when it is not known when auto-apply was first on", () => {
    expect(needsAutoReview({ id: notSampled, decidedAt: D("2027-01-01T00:00:00Z") }, { firstEnabledAt: null, guideApprovals: [] })).toBe(true);
  });
});

describe("what an error is", () => {
  const decidedAt = D("2026-11-01T00:00:00Z");
  it("a revert", () => {
    expect(autoErrorAt({ decidedAt, revertedAt: D("2026-11-05T00:00:00Z") }, [])).toEqual(D("2026-11-05T00:00:00Z"));
  });
  it("a change to the item within 30 days, the earliest one", () => {
    expect(autoErrorAt({ decidedAt, revertedAt: null }, [D("2026-11-20T00:00:00Z"), D("2026-11-10T00:00:00Z")])).toEqual(D("2026-11-10T00:00:00Z"));
  });
  it("not a change after 30 days, and nothing at all", () => {
    expect(autoErrorAt({ decidedAt, revertedAt: null }, [D("2026-12-15T00:00:00Z")])).toBeNull();
    expect(autoErrorAt({ decidedAt, revertedAt: null }, [])).toBeNull();
  });
});

describe("a kind goes back to a person", () => {
  const at = (i: number) => new Date(D("2026-11-01T00:00:00Z").getTime() + i * 3_600_000);
  const rows = (errors: number[], n = 30) => Array.from({ length: n }, (_, i) => ({ decidedAt: at(i), error: errors.includes(i) }));

  it("at 3 errors in its last 30", () => {
    expect(kindPauseDue(rows([1, 2]), null)).toMatchObject({ due: false, errors: 2, counted: 30 });
    expect(kindPauseDue(rows([1, 2, 3]), null)).toMatchObject({ due: true, errors: 3 });
  });

  it("only the last 30 count", () => {
    // 40 rows; errors at 0..2 are the oldest ten, outside the window.
    expect(kindPauseDue(rows([0, 1, 2], 40), null)).toMatchObject({ due: false, errors: 0, counted: 30 });
  });

  it("only after the latest guide approval or lift", () => {
    expect(kindPauseDue(rows([1, 2, 3, 20]), at(10))).toMatchObject({ due: false, errors: 1, counted: 19 });
  });
});

describe("a client goes back to a person", () => {
  const now = D("2026-11-30T00:00:00Z");
  it("at 2 errors within 14 days", () => {
    expect(clientPauseDue([D("2026-11-20T00:00:00Z")], now, null).due).toBe(false);
    expect(clientPauseDue([D("2026-11-20T00:00:00Z"), D("2026-11-25T00:00:00Z")], now, null)).toEqual({ due: true, errors: 2 });
  });
  it("not when one is older than 14 days, or before the latest lift", () => {
    expect(clientPauseDue([D("2026-11-01T00:00:00Z"), D("2026-11-25T00:00:00Z")], now, null).due).toBe(false);
    expect(clientPauseDue([D("2026-11-20T00:00:00Z"), D("2026-11-25T00:00:00Z")], now, D("2026-11-22T00:00:00Z")).due).toBe(false);
  });
});

describe("the bar for lifting a pause", () => {
  it("a lower bound, not the raw share", () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(10, 10)).toBeLessThan(0.85);
    expect(wilsonLower(30, 30)).toBeGreaterThan(0.85);
  });
  it("30 decisions at least, and a lower bound of 85%", () => {
    expect(liftBarMet(29, 29)).toBe(false);
    expect(liftBarMet(30, 30)).toBe(true);
    expect(liftBarMet(28, 30)).toBe(false);
  });
});

describe("Claude's decisions on an auto-applied item (decide_knowledge_proposals)", () => {
  const AUTO = { autoApplied: true, autoReviewedAt: null, state: "APPROVED", action: "CREATE", target: "FACT", attached: false, resultId: "f1", revertedAt: null };
  it("only on what entered automatically", () => {
    expect(autoDecisionBlocker("reviewed_ok", { ...AUTO, autoApplied: false }, true)).toContain("enteredAutomatically");
    expect(autoDecisionBlocker("revert", { ...AUTO, autoApplied: false }, true)).toContain("enteredAutomatically");
  });
  it("reviewed_ok: only while it still waits for a look", () => {
    expect(autoDecisionBlocker("reviewed_ok", AUTO, true)).toBeNull();
    expect(autoDecisionBlocker("reviewed_ok", AUTO, false)).toContain("not waiting");
    expect(autoDecisionBlocker("reviewed_ok", { ...AUTO, autoReviewedAt: D("2026-11-03T00:00:00Z") }, true)).toContain("already marked");
    expect(autoDecisionBlocker("reviewed_ok", { ...AUTO, revertedAt: D("2026-11-03T00:00:00Z") }, true)).toContain("taken out");
  });
  it("revert: while revertBlocker allows it, looked at or not", () => {
    expect(autoDecisionBlocker("revert", AUTO, false)).toBeNull();
    expect(autoDecisionBlocker("revert", { ...AUTO, autoReviewedAt: D("2026-11-03T00:00:00Z") }, false)).toBeNull();
    expect(autoDecisionBlocker("revert", { ...AUTO, revertedAt: D("2026-11-03T00:00:00Z") }, true)).toContain("כבר בוטלה");
    expect(autoDecisionBlocker("revert", { ...AUTO, resultId: null }, true)).toContain("cannot be taken out");
  });
});
