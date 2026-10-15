import { describe, expect, it } from "vitest";
import { ruleCheckSummary, ruleChecks, type ProcessStep, type RuleForCheck } from "@/lib/process-rules";
import { checkFieldsError, checkFieldsFor, sameCheckFields } from "@/lib/client-policies";

// The client's rules against a procedure's steps (org-brain spec 7.2: R7,
// R8, R9, R10, R15). Each one fires on what breaks it and on nothing else,
// and an exception to the rule turns the finding into a note.

const step = (over: Partial<ProcessStep>): ProcessStep => ({
  title: "שלב",
  mode: "MANUAL",
  offsetBusinessDays: null,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  channel: null,
  ...over,
});

const rule = (over: Partial<RuleForCheck>): RuleForCheck => ({ id: "r1", kind: "INFO", title: "כלל", checkTags: [], requiredTags: [], channels: [], minLeadBusinessDays: null, ...over });
const none = new Set<string>();
const LTD = { entityId: "ltd" };

describe("ruleChecks", () => {
  it("R15: a forbidden action, by step", () => {
    const r = rule({ kind: "FORBIDDEN", checkTags: ["PAYMENT"] });
    expect(ruleChecks([step({}), step({ actionTags: ["PAYMENT"] })], LTD, [r], none).map((f) => [f.code, f.step])).toEqual([["R15", 2]]);
    expect(ruleChecks([step({ actionTags: ["INVOICE"] })], LTD, [r], none)).toEqual([]);
  });

  it("R7: an action that needs another step, only when the action is there", () => {
    const r = rule({ kind: "REQUIRED_STEP", checkTags: ["PAYMENT"], requiredTags: ["INVOICE"] });
    expect(ruleChecks([step({ actionTags: ["PAYMENT"] })], LTD, [r], none).map((f) => f.code)).toEqual(["R7"]);
    expect(ruleChecks([step({ actionTags: ["INVOICE"] }), step({ actionTags: ["PAYMENT"] })], LTD, [r], none)).toEqual([]);
    expect(ruleChecks([step({ actionTags: ["CLIENT_MESSAGE"] })], LTD, [r], none)).toEqual([]);
  });

  it("R9: a step too close to the date", () => {
    const r = rule({ kind: "TIMING", checkTags: ["CLIENT_MESSAGE"], minLeadBusinessDays: 2 });
    expect(ruleChecks([step({ actionTags: ["CLIENT_MESSAGE"], offsetBusinessDays: -1 })], LTD, [r], none).map((f) => f.code)).toEqual(["R9"]);
    expect(ruleChecks([step({ actionTags: ["CLIENT_MESSAGE"] })], LTD, [r], none).map((f) => f.code)).toEqual(["R9"]);
    expect(ruleChecks([step({ actionTags: ["CLIENT_MESSAGE"], offsetBusinessDays: -2 })], LTD, [r], none)).toEqual([]);
  });

  it("R10: a message to the client in a channel the rule does not allow, or in none", () => {
    const r = rule({ kind: "COMMUNICATION", channels: ["EMAIL"] });
    const msg = (channel: ProcessStep["channel"]) => step({ actionTags: ["CLIENT_MESSAGE"], channel });
    expect(ruleChecks([msg("WHATSAPP"), msg(null), msg("EMAIL")], LTD, [r], none).map((f) => f.step)).toEqual([1, 2]);
  });

  it("R8: money or invoices with no entity, when the client separates its entities", () => {
    const r = rule({ kind: "SEPARATION" });
    expect(ruleChecks([step({ actionTags: ["INVOICE"] })], { entityId: null }, [r], none).map((f) => f.code)).toEqual(["R8"]);
    expect(ruleChecks([step({ actionTags: ["INVOICE"] })], LTD, [r], none)).toEqual([]);
    expect(ruleChecks([step({ actionTags: ["CLIENT_MESSAGE"] })], { entityId: null }, [r], none)).toEqual([]);
  });

  it("an exception in force marks the finding instead of dropping it", () => {
    const r = rule({ kind: "FORBIDDEN", checkTags: ["PAYMENT"] });
    const [f] = ruleChecks([step({ actionTags: ["PAYMENT"] })], LTD, [r], new Set(["r1"]));
    expect(f.excepted).toBe(true);
  });

  it("a rule with nothing to check is read, not checked", () => {
    expect(ruleChecks([step({ actionTags: ["PAYMENT"] })], LTD, [rule({ kind: "FORBIDDEN" })], none)).toEqual([]);
    expect(ruleCheckSummary(rule({ kind: "FORBIDDEN" }))).toBeNull();
    expect(ruleCheckSummary(rule({ kind: "FORBIDDEN", checkTags: ["PAYMENT"] }))).toContain("תשלום");
  });
});

describe("the structured part of a rule", () => {
  it("keeps only what the kind takes, refuses half a check, and compares regardless of order", () => {
    expect(checkFieldsFor("COMMUNICATION", { channels: ["EMAIL"], checkTags: ["PAYMENT"] })).toEqual({ checkTags: [], requiredTags: [], channels: ["EMAIL"], minLeadBusinessDays: null });
    expect(checkFieldsError("TIMING", checkFieldsFor("TIMING", { checkTags: ["PAYMENT"] }))).not.toBeNull();
    expect(checkFieldsError("TIMING", checkFieldsFor("TIMING", { checkTags: ["PAYMENT"], minLeadBusinessDays: 61 }))).not.toBeNull();
    expect(checkFieldsError("TIMING", checkFieldsFor("TIMING", { checkTags: ["PAYMENT"], minLeadBusinessDays: 2 }))).toBeNull();
    expect(checkFieldsError("REQUIRED_STEP", checkFieldsFor("REQUIRED_STEP", { checkTags: ["PAYMENT"] }))).not.toBeNull();
    const a = checkFieldsFor("COMMUNICATION", { channels: ["EMAIL", "PORTAL"] });
    expect(sameCheckFields(a, checkFieldsFor("COMMUNICATION", { channels: ["PORTAL", "EMAIL"] }))).toBe(true);
  });
});
