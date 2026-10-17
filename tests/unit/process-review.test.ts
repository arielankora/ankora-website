import { describe, expect, it } from "vitest";
import { isReviewDue, readReviewReason, reviewDueAt, reviewEveryError, ruleChangeCause } from "@/lib/process-review";

// Org brain (spec 5.4, 7.3): when a procedure's periodic review falls due,
// and what a rule change says about itself.

describe("periodic review", () => {
  const last = new Date("2026-10-01T09:00:00Z");
  it("falls due N days after the last review, and never without a period or a review", () => {
    expect(reviewDueAt({ reviewEveryDays: 30, lastReviewedAt: last })!.toISOString()).toBe("2026-10-31T09:00:00.000Z");
    expect(isReviewDue({ reviewEveryDays: 30, lastReviewedAt: last }, new Date("2026-10-31T08:59:00Z"))).toBe(false);
    expect(isReviewDue({ reviewEveryDays: 30, lastReviewedAt: last }, new Date("2026-10-31T09:00:00Z"))).toBe(true);
    expect(reviewDueAt({ reviewEveryDays: null, lastReviewedAt: last })).toBeNull();
    expect(reviewDueAt({ reviewEveryDays: 30, lastReviewedAt: null })).toBeNull();
  });
  it("is a whole number of days, up to two years", () => {
    expect(reviewEveryError(90)).toBeNull();
    expect(reviewEveryError(null)).toBeNull();
    expect(reviewEveryError(0)).not.toBeNull();
    expect(reviewEveryError(1.5)).not.toBeNull();
    expect(reviewEveryError(731)).not.toBeNull();
  });
  it("reads only the reasons it knows", () => {
    expect(readReviewReason("RULES")).toBe("RULES");
    expect(readReviewReason("other")).toBeNull();
  });
});

describe("ruleChangeCause", () => {
  it("names a rule meant for everyone, and only that", () => {
    expect(ruleChangeCause({ title: "ספק חדש", audience: "ALL_STAFF" }, "כלל אושר")).toBe('כלל אושר: "ספק חדש"');
    expect(ruleChangeCause({ title: "עסקה סודית", audience: "RESTRICTED" }, "כלל אושר")).not.toContain("עסקה");
  });
});
