import { describe, expect, it } from "vitest";
import { changesSubstance, ruleBindsNow, ruleDatesLine, ruleInForce, ruleLine, ruleReviewDue } from "@/lib/client-policies";
import { paramsInForce } from "@/lib/policy-params";

// Spec 3.11: a rule that starts on a date, and one that is looked at again.

const now = new Date("2026-10-18T09:00:00Z");
const later = new Date("2027-01-01T00:00:00Z");
const earlier = new Date("2026-10-01T00:00:00Z");
const rule = { status: "ACTIVE" as const, title: "סף", statement: "מעל 5,000 באישור", interimStatement: null };

describe("a rule with a start date", () => {
  it("is read before it starts, and binds nothing until then", () => {
    expect(ruleInForce({ ...rule, effectiveFrom: later }, now)).toEqual({ text: "מעל 5,000 באישור", interim: false, startsOn: later });
    expect(ruleBindsNow({ ...rule, effectiveFrom: later }, now)).toBe(false);
    expect(ruleBindsNow({ ...rule, effectiveFrom: earlier }, now)).toBe(true);
    expect(ruleBindsNow(rule, now)).toBe(true);
    const params = { amountMinor: 500000, currency: "ILS", appliesToTags: ["PAYMENT"] };
    expect(paramsInForce({ ...rule, kind: "THRESHOLD", params, interimParams: {}, effectiveFrom: later }, now)).toEqual({});
    expect(paramsInForce({ ...rule, kind: "THRESHOLD", params, interimParams: {}, effectiveFrom: earlier }, now)).toMatchObject({ amountMinor: 500000 });
  });

  it("a proposed rule's interim rule applies now, whatever the start date", () => {
    expect(ruleInForce({ ...rule, status: "PROPOSED", interimStatement: "הכול באישור", effectiveFrom: later }, now)).toEqual({ text: "הכול באישור", interim: true });
  });

  it("moving the start date is a change to what the rule says", () => {
    expect(changesSubstance({ ...rule, kind: "THRESHOLD", effectiveFrom: earlier }, { effectiveFrom: later })).toBe(true);
    expect(changesSubstance({ ...rule, kind: "THRESHOLD", effectiveFrom: earlier }, { effectiveFrom: new Date("2026-10-01T00:00:00Z") })).toBe(false);
    expect(changesSubstance({ ...rule, kind: "THRESHOLD", effectiveFrom: null }, {})).toBe(false);
  });
});

describe("a rule's review date", () => {
  it("is due once passed, and never for a retired rule", () => {
    expect(ruleReviewDue({ status: "ACTIVE", reviewBy: earlier }, now)).toBe(true);
    expect(ruleReviewDue({ status: "ACTIVE", reviewBy: later }, now)).toBe(false);
    expect(ruleReviewDue({ status: "RETIRED", reviewBy: earlier }, now)).toBe(false);
    expect(ruleReviewDue({ status: "ACTIVE" }, now)).toBe(false);
  });

  it("both read as one line", () => {
    expect(ruleDatesLine({ status: "ACTIVE", effectiveFrom: later, reviewBy: earlier }, now)).toBe("נכנס לתוקף ב-1.1.2027 · מועד הסקירה עבר (1.10.2026)");
    expect(ruleDatesLine({ status: "ACTIVE", effectiveFrom: earlier, reviewBy: later }, now)).toBe("בתוקף מ-1.10.2026 · לסקירה עד 1.1.2027");
    expect(ruleDatesLine({ status: "ACTIVE" }, now)).toBeNull();
    expect(ruleLine({ ...rule, effectiveFrom: new Date("2099-01-01T00:00:00Z") })).toBe("סף: מ-1.1.2099, מעל 5,000 באישור");
  });
});
