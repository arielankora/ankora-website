import { describe, expect, it } from "vitest";
import { isOwnDetailsUpdate } from "@/lib/mail-scan/own-details";
import { autoReviewReasonCode, needsAutoReview } from "@/lib/auto-apply";

// Stage 3 of "התיבות שלי" (27.11.2026): a contact's own details from the
// contact's own email enter on their own; and what enters from emails is
// all looked at for the first 14 days.

const base = { target: "CONTACT", action: "SUPERSEDE", payload: { phones: ["+972501234567"] }, flags: [], level: "HIGH" };
const ctx = { contactEmails: ["Nadav@Grantor.co.il"], threadSenders: ["nadav@grantor.co.il", "anna@ankora.co.il"] };

describe("mail extraction: a contact's own details", () => {
  it("enter when the contact wrote in the thread and only their own fields change", () => {
    expect(isOwnDetailsUpdate(base, ctx)).toBe(true);
    expect(isOwnDetailsUpdate({ ...base, payload: { role: "סמנכ\"ל כספים", name: "נדב דדון", emails: ["nadav@grantor.co.il"], sources: [{ code: "S4" }] } }, ctx)).toBe(true);
  });

  it("not when someone else wrote it, the change is about other fields, or it is a new item", () => {
    expect(isOwnDetailsUpdate(base, { ...ctx, threadSenders: ["dana@grantor.co.il"] })).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, payload: { phones: ["+97250"], relationship: "SUPPLIER" } }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, payload: { context: "עבר לתפקיד אחר" } }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, action: "CREATE" }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, target: "FACT" }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, payload: { sources: [] } }, ctx)).toBe(false);
  });

  it("not when it is unsure, sensitive, not of high confidence, or something blocks it", () => {
    expect(isOwnDetailsUpdate({ ...base, level: "MEDIUM" }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, payload: { phones: ["+97250"], knowledgeStatus: "UNCERTAIN" } }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, payload: { phones: ["+97250"], sensitivity: "SENSITIVE" } }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, flags: [{ code: "R6" }] }, ctx)).toBe(false);
    expect(isOwnDetailsUpdate({ ...base, flags: [{ code: "X", block: true }] }, ctx)).toBe(false);
  });
});

describe("mail extraction: what entered from emails is looked at first", () => {
  const firstEnabledAt = new Date("2026-11-01T00:00:00Z");
  const decidedAt = new Date("2026-12-20T10:00:00Z");
  const old = { firstEnabledAt, guideApprovals: [] as Date[] };
  it("every email item in the 14 days after the first one entered, and before any did", () => {
    expect(needsAutoReview({ id: "zzzz-not-in-sample", decidedAt, fromEmail: true }, { ...old, firstEmailAutoAt: new Date("2026-12-10T00:00:00Z") })).toBe(true);
    expect(needsAutoReview({ id: "zzzz-not-in-sample", decidedAt, fromEmail: true }, { ...old, firstEmailAutoAt: null })).toBe(true);
    expect(autoReviewReasonCode({ id: "x", decidedAt, fromEmail: true }, { ...old, firstEmailAutoAt: new Date("2026-12-10T00:00:00Z") })).toEqual({ code: "firstDays", days: 14 });
  });
  it("after those days, the ordinary sample; a meeting's item is untouched by it", () => {
    const after = { ...old, firstEmailAutoAt: new Date("2026-11-20T00:00:00Z") };
    const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
    const sampled = ids.filter((id) => needsAutoReview({ id, decidedAt, fromEmail: true }, after)).length;
    expect(sampled).toBeLessThan(50);
    expect(ids.filter((id) => needsAutoReview({ id, decidedAt }, after)).length).toBe(ids.filter((id) => needsAutoReview({ id, decidedAt }, old)).length);
  });
});
