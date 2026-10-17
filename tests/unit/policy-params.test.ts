import { describe, expect, it } from "vitest";
import {
  invoiceAllowed,
  invoiceGaps,
  paramsError,
  paramsInForce,
  paramsKey,
  paramsSummary,
  readParams,
  requestTypeConflicts,
  ruleChecks,
  type RuleForCheck,
} from "@/lib/policy-params";
import type { ProcessStep } from "@/lib/process-rules";

// Org brain, phase 3 (claude/org-brain-spec-2026-10-12.md, 3.11, 7.2): a
// client's rule in a form the server can check, and the checks R2, R7 to
// R10, R15, R16.

const step = (over: Partial<ProcessStep>): ProcessStep => ({
  title: "שלב",
  mode: "MANUAL",
  offsetBusinessDays: null,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  amountMaxMinor: null,
  currency: null,
  channel: null,
  ...over,
});

const rule = (kind: RuleForCheck["kind"], params: RuleForCheck["params"]): RuleForCheck => ({ id: `r-${kind}`, title: `כלל ${kind}`, kind, params });
const proc = (steps: ProcessStep[], over: { entityId?: string | null; externalParties?: { name: string; entityId: string | null }[] } = {}) => ({
  steps,
  entityId: over.entityId ?? null,
  externalParties: over.externalParties ?? [],
});

describe("readParams", () => {
  it("keeps only what the kind takes, and drops what is malformed", () => {
    expect(readParams("THRESHOLD", { amountMinor: 300000, currency: "usd", channels: ["EMAIL"], appliesToTags: ["PAYMENT", "NOPE"] })).toEqual({
      amountMinor: 300000,
      currency: "USD",
      appliesToTags: ["PAYMENT"],
    });
    expect(readParams("INFO", { amountMinor: 1 })).toEqual({});
    expect(readParams("THRESHOLD", { amountMinor: -5, currency: "dollars" })).toEqual({});
    expect(readParams("COMMUNICATION", { invoiceTo: ["@NUX.ai", " billing-us@nux.ai "] })).toEqual({ invoiceTo: ["nux.ai", "billing-us@nux.ai"] });
  });

  it("says what is missing, and nothing about a text-only rule", () => {
    expect(paramsError("THRESHOLD", {})).toBeNull();
    expect(paramsError("THRESHOLD", { amountMinor: 100 })).toContain("מטבע");
    expect(paramsError("SEPARATION", { entityIds: ["a"] })).toContain("שתי ישויות");
    expect(paramsError("TIMING", { leadBusinessDays: 2, appliesToTags: ["PAYMENT"] })).toBeNull();
  });

  it("compares parameters regardless of order", () => {
    expect(paramsKey({ appliesToTags: ["PAYMENT", "PURCHASE"], amountMinor: 1 })).toBe(paramsKey({ amountMinor: 1, appliesToTags: ["PURCHASE", "PAYMENT"] }));
  });
});

describe("paramsInForce", () => {
  const threshold = { kind: "THRESHOLD" as const, params: { amountMinor: 300000, currency: "USD" }, interimParams: {} };
  it("an approved rule as written; a retired one not at all", () => {
    expect(paramsInForce({ ...threshold, status: "ACTIVE", interimStatement: null })).toEqual({ amountMinor: 300000, currency: "USD" });
    expect(paramsInForce({ ...threshold, status: "RETIRED", interimStatement: null })).toEqual({});
  });
  it("a proposed threshold with an interim rule and no interim amount is a threshold of zero", () => {
    expect(paramsInForce({ ...threshold, status: "PROPOSED", interimStatement: "כל הוצאה לאורן" })).toEqual({ amountMinor: 0, currency: "USD" });
  });
  it("interim parameters, when given, are what applies", () => {
    expect(paramsInForce({ ...threshold, interimParams: { amountMinor: 50000, currency: "USD" }, status: "PROPOSED", interimStatement: "עד 500" })).toEqual({
      amountMinor: 50000,
      currency: "USD",
    });
  });
});

describe("ruleChecks", () => {
  const usd3000 = rule("THRESHOLD", { amountMinor: 300000, currency: "USD" });

  it("R2: a payment above the threshold, or of unknown size, needs an approval at or before it", () => {
    const above = ruleChecks(proc([step({ actionTags: ["PAYMENT"], amountMaxMinor: 500000, currency: "USD" })]), [usd3000]);
    expect(above).toEqual([expect.objectContaining({ code: "R2", severity: "BLOCK", step: 1 })]);
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] })]), [usd3000])).toHaveLength(1);
    // Another currency is a size we cannot compare.
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"], amountMaxMinor: 100, currency: "ILS" })]), [usd3000])).toHaveLength(1);
  });

  it("R2: below the threshold passes, and so does an approval step before the payment", () => {
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"], amountMaxMinor: 100000, currency: "USD" })]), [usd3000])).toEqual([]);
    expect(ruleChecks(proc([step({ title: "אורן מאשר", requiresApproval: true }), step({ actionTags: ["PAYMENT"] })]), [usd3000])).toEqual([]);
    // An approval after the payment is too late.
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] }), step({ requiresApproval: true })]), [usd3000])).toHaveLength(1);
  });

  it("R2: an approval rule on a tag", () => {
    const r = rule("APPROVAL_REQUIRED", { appliesToTags: ["SUPPLIER_NEW"] });
    expect(ruleChecks(proc([step({ actionTags: ["SUPPLIER_NEW"] })]), [r])).toEqual([expect.objectContaining({ code: "R2", severity: "BLOCK" })]);
    expect(ruleChecks(proc([step({ actionTags: ["SUPPLIER_NEW"], requiresApproval: true })]), [r])).toEqual([]);
  });

  it("a rule of one entity does not bind another's procedure", () => {
    const inc = rule("THRESHOLD", { amountMinor: 0, currency: "USD", entityId: "inc" });
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] })], { entityId: "ltd" }), [inc])).toEqual([]);
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] })], { entityId: "inc" }), [inc])).toHaveLength(1);
  });

  it("R7: a required step, by its words, only where the rule says", () => {
    const r = rule("REQUIRED_STEP", { mustInclude: "סיווג ומחלקה", appliesToTags: ["SUPPLIER_NEW"] });
    expect(ruleChecks(proc([step({ actionTags: ["INVOICE"] })]), [r])).toEqual([]);
    expect(ruleChecks(proc([step({ actionTags: ["SUPPLIER_NEW"] })]), [r])).toEqual([expect.objectContaining({ code: "R7", severity: "EXCEPTION" })]);
    expect(ruleChecks(proc([step({ actionTags: ["SUPPLIER_NEW"], title: "פתקית עם  סיווג ומחלקה" })]), [r])).toEqual([]);
  });

  it("R8: a money step needs an entity, and no external party of the other entity", () => {
    const r = rule("SEPARATION", { entityIds: ["inc", "ltd"] });
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] })]), [r])).toEqual([expect.objectContaining({ code: "R8" })]);
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] })], { entityId: "ltd", externalParties: [{ name: "איילה", entityId: "ltd" }] }), [r])).toEqual([]);
    expect(ruleChecks(proc([step({})], { entityId: "inc", externalParties: [{ name: "איילה", entityId: "ltd" }] }), [r])).toEqual([
      expect.objectContaining({ code: "R8", message: expect.stringContaining("איילה") }),
    ]);
  });

  it("R9: the step happens early enough", () => {
    const r = rule("TIMING", { leadBusinessDays: 2, appliesToTags: ["CLIENT_MESSAGE"] });
    expect(ruleChecks(proc([step({ actionTags: ["CLIENT_MESSAGE"], offsetBusinessDays: -2 })]), [r])).toEqual([]);
    expect(ruleChecks(proc([step({ actionTags: ["CLIENT_MESSAGE"], offsetBusinessDays: -1 })]), [r])).toEqual([expect.objectContaining({ code: "R9" })]);
    expect(ruleChecks(proc([step({ actionTags: ["CLIENT_MESSAGE"] })]), [r])).toEqual([expect.objectContaining({ code: "R9" })]);
  });

  it("R10: a client message goes through an allowed channel, and says which", () => {
    const r = rule("COMMUNICATION", { channels: ["EMAIL"] });
    expect(ruleChecks(proc([step({ actionTags: ["CLIENT_MESSAGE"], channel: "EMAIL" })]), [r])).toEqual([]);
    expect(ruleChecks(proc([step({ actionTags: ["CLIENT_MESSAGE"], channel: "WHATSAPP" })]), [r])).toEqual([expect.objectContaining({ code: "R10" })]);
    expect(ruleChecks(proc([step({ actionTags: ["CLIENT_MESSAGE"] })]), [r])).toEqual([expect.objectContaining({ code: "R10" })]);
  });

  it("R15: a forbidden action", () => {
    const r = rule("FORBIDDEN", { appliesToTags: ["CREDENTIAL_ACCESS"] });
    expect(ruleChecks(proc([step({ actionTags: ["CREDENTIAL_ACCESS"] })]), [r])).toEqual([expect.objectContaining({ code: "R15", severity: "EXCEPTION" })]);
  });

  it("a text-only rule is not checked", () => {
    expect(ruleChecks(proc([step({ actionTags: ["PAYMENT"] })]), [rule("THRESHOLD", {})])).toEqual([]);
  });
});

describe("R16 and request types", () => {
  const billing = rule("COMMUNICATION", { invoiceTo: ["billing-us@nux.ai", "billing-il@nux.ai"] });

  it("matches an address, or any address at an allowed domain", () => {
    expect(invoiceAllowed("Billing-US@nux.ai", ["billing-us@nux.ai"])).toBe(true);
    expect(invoiceAllowed("office@nux.ai", ["nux.ai"])).toBe(true);
    expect(invoiceAllowed("oren@gmail.com", ["nux.ai"])).toBe(false);
  });

  it("a billed system whose invoice goes elsewhere, or nowhere known, is a gap", () => {
    const gaps = invoiceGaps(
      [
        { id: "s1", systemName: "Anthropic", invoiceTo: "oren@gmail.com", billed: true, entityId: null },
        { id: "s2", systemName: "Slack", invoiceTo: "billing-us@nux.ai", billed: true, entityId: null },
        { id: "s3", systemName: "Doka", invoiceTo: null, billed: true, entityId: null },
        { id: "s4", systemName: "Washington DOR", invoiceTo: null, billed: false, entityId: null },
      ],
      [billing]
    );
    expect(gaps.map((g) => g.systemId)).toEqual(["s1", "s3"]);
  });

  it("an Inc request type routed to an Ltd contact", () => {
    const sep = rule("SEPARATION", { entityIds: ["inc", "ltd"] });
    const out = requestTypeConflicts(
      [
        { id: "t1", title: "חשבונית Inc", entityId: "inc", routes: [{ name: "איילה", entityId: "ltd" }, { name: "שני", entityId: "inc" }] },
        { id: "t2", title: "חשבונית LTD", entityId: "ltd", routes: [{ name: "איילה", entityId: "ltd" }] },
      ],
      [sep]
    );
    expect(out).toEqual([expect.objectContaining({ requestTypeId: "t1", message: expect.stringContaining("איילה") })]);
  });
});

describe("paramsSummary", () => {
  it("says in a line what is checked", () => {
    expect(paramsSummary("THRESHOLD", { amountMinor: 300000, currency: "USD" }, () => "")).toBe("תשלום, רכישה, זיכוי מעל 3,000 USD דורש שלב אישור");
    expect(paramsSummary("THRESHOLD", {}, () => "")).toBeNull();
    expect(paramsSummary("SEPARATION", { entityIds: ["a", "b"] }, (id) => (id === "a" ? "Inc" : "LTD"))).toContain("Inc ל-LTD");
  });
});
