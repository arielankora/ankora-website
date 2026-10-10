import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAN_MESSAGE,
  MAX_PLAN_LENGTH,
  MAX_PLAN_STEPS,
  PLAN_TOO_LONG_MESSAGE,
  TOO_MANY_STEPS_MESSAGE,
  TaskPlanRuleError,
  normalizePlanBody,
  normalizePlanSteps,
  planVersionConflict,
} from "@/lib/task-plan-rules";

// "קדם עם קלוד" (10.10.2026). No project imports, so these run in the
// sandbox. The domain (lib/app-domain/task-plans.ts) applies them to every
// save, from Claude and from the screen alike.

describe("normalizePlanBody()", () => {
  it("trims and unifies line endings", () => {
    expect(normalizePlanBody("  **מטרה**\r\nלסגור\r\n  ")).toBe("**מטרה**\nלסגור");
  });

  it("refuses an empty plan with a sentence a person can act on", () => {
    expect(() => normalizePlanBody("   \n ")).toThrow(EMPTY_PLAN_MESSAGE);
    expect(() => normalizePlanBody("")).toThrow(TaskPlanRuleError);
  });

  it("refuses a plan over the limit rather than cutting it", () => {
    expect(() => normalizePlanBody("א".repeat(MAX_PLAN_LENGTH + 1))).toThrow(PLAN_TOO_LONG_MESSAGE);
    expect(normalizePlanBody("א".repeat(MAX_PLAN_LENGTH))).toHaveLength(MAX_PLAN_LENGTH);
  });
});

describe("normalizePlanSteps()", () => {
  it("strips the numbering and bullets a model adds, and drops empty lines", () => {
    expect(normalizePlanSteps(["1. לבקש דוח", "2) להתאים", "- לסגור", "", "   "])).toEqual(["לבקש דוח", "להתאים", "לסגור"]);
  });

  it("drops an exact repeat", () => {
    expect(normalizePlanSteps(["לבקש דוח", "לבקש  דוח"])).toEqual(["לבקש דוח"]);
  });

  it("keeps a number that is part of the step", () => {
    expect(normalizePlanSteps(["3 הצעות מחיר מספקים"])).toEqual(["3 הצעות מחיר מספקים"]);
  });

  it("cuts a paragraph down to one line", () => {
    const [only] = normalizePlanSteps(["א".repeat(500)]);
    expect(only.length).toBeLessThanOrEqual(200);
    expect(only.endsWith("…")).toBe(true);
  });

  it("treats a missing list as no steps", () => {
    expect(normalizePlanSteps(undefined)).toEqual([]);
    expect(normalizePlanSteps(null)).toEqual([]);
  });

  it("refuses more than the checklist ceiling", () => {
    const many = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => `שלב ${i}`);
    expect(() => normalizePlanSteps(many)).toThrow(TOO_MANY_STEPS_MESSAGE);
  });
});

describe("planVersionConflict()", () => {
  it("lets a first save through with or without a base version", () => {
    expect(planVersionConflict(0, undefined)).toBe(false);
    expect(planVersionConflict(0, 0)).toBe(false);
  });

  it("lets a save written against the latest version through", () => {
    expect(planVersionConflict(3, 3)).toBe(false);
  });

  it("refuses a save written against an older version", () => {
    expect(planVersionConflict(4, 3)).toBe(true);
  });

  it("refuses a save that did not say what it read, once a plan exists", () => {
    // Otherwise a client that forgot the field would overwrite silently.
    expect(planVersionConflict(1, undefined)).toBe(true);
    expect(planVersionConflict(1, null)).toBe(true);
  });

  it("refuses a base version from the future", () => {
    expect(planVersionConflict(2, 5)).toBe(true);
  });
});
