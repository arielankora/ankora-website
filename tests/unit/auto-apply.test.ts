import { describe, expect, it } from "vitest";
import {
  AUTO_REVIEW_SAMPLE_PERCENT,
  autoDecisionBlocker,
  autoError,
  autoOutcome,
  changedFields,
  isNewerSource,
  proposalSource,
  summarizeAutoErrors,
  REVERT_SLACK_MS,
  autoReviewReason,
  autoReviewReasonCode,
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

  it("28.11.2026: every update (SUPERSEDE) in the 14 days after updates began to enter, then the sample", () => {
    const start = new Date(first.getTime() + 25 * DAY);
    const c = { ...ctx, supersedeEnabledAt: start };
    const inside = new Date(start.getTime() + 13 * DAY);
    const after = new Date(start.getTime() + 15 * DAY);
    expect(needsAutoReview({ id: notSampled, decidedAt: inside, action: "SUPERSEDE" }, c)).toBe(true);
    expect(autoReviewReason({ id: notSampled, decidedAt: inside, action: "SUPERSEDE" }, c)).toBe("עדכונים, 14 הימים הראשונים: בודקים כל עדכון");
    expect(autoReviewReasonCode({ id: notSampled, decidedAt: inside, action: "SUPERSEDE" }, c)).toEqual({ code: "firstDays", days: 14 });
    // A new item at the same moment: only the sample, as before.
    expect(needsAutoReview({ id: notSampled, decidedAt: inside, action: "CREATE" }, c)).toBe(false);
    expect(needsAutoReview({ id: notSampled, decidedAt: after, action: "SUPERSEDE" }, c)).toBe(false);
    expect(needsAutoReview({ id: sampled, decidedAt: after, action: "SUPERSEDE" }, c)).toBe(true);
    // No start kept: every update is looked at.
    expect(needsAutoReview({ id: notSampled, decidedAt: after, action: "SUPERSEDE" }, { ...ctx, supersedeEnabledAt: null })).toBe(true);
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
  const change = (action: string, at: string, before?: unknown, after?: unknown) => ({ action, at: D(at), before, after });
  it("a revert", () => {
    expect(autoError({ decidedAt, revertedAt: D("2026-11-05T00:00:00Z") }, [])).toEqual({ type: "REVERTED", at: D("2026-11-05T00:00:00Z"), fields: [] });
  });
  it("a change to the item within 30 days, the earliest one", () => {
    const e = autoError({ decidedAt, revertedAt: null }, [change("client_fact.remove", "2026-11-20T00:00:00Z"), change("client_fact.supersede", "2026-11-10T00:00:00Z", { body: "a" }, { body: "b" })]);
    expect(e).toEqual({ type: "SUPERSEDED", at: D("2026-11-10T00:00:00Z"), fields: ["body"] });
  });
  it("not a change after 30 days, nor before it entered, nor an action that is not a change, and nothing at all", () => {
    expect(autoError({ decidedAt, revertedAt: null }, [change("client_fact.remove", "2026-12-15T00:00:00Z")])).toBeNull();
    expect(autoError({ decidedAt, revertedAt: null }, [change("client_contact.update", "2026-10-31T00:00:00Z")])).toBeNull();
    expect(autoError({ decidedAt, revertedAt: null }, [change("client_fact.confirm", "2026-11-02T00:00:00Z")])).toBeNull();
    expect(autoError({ decidedAt, revertedAt: null }, [])).toBeNull();
  });
  it("names each type", () => {
    const one = (action: string) => autoError({ decidedAt, revertedAt: null }, [change(action, "2026-11-02T00:00:00Z", { a: 1 }, { a: 1 })])?.type;
    expect(one("client_fact.contradict")).toBe("CONTRADICTED");
    expect(one("client_contact.update")).toBe("UPDATED");
    expect(one("client_organization.update")).toBe("UPDATED");
    expect(one("client_entity.update")).toBe("UPDATED");
    expect(one("client_contact.remove")).toBe("REMOVED");
    expect(one("client_entity.remove")).toBe("REMOVED");
  });
  it("the removal a revert makes is the revert, not a second error; a removal well before it is its own", () => {
    const revertedAt = D("2026-11-05T00:00:00Z");
    const own = new Date(revertedAt.getTime() + 5).toISOString();
    expect(autoError({ decidedAt, revertedAt }, [change("client_contact.remove", own)])).toMatchObject({ type: "REVERTED" });
    // Clocks a moment apart: still the revert.
    const skew = new Date(revertedAt.getTime() - REVERT_SLACK_MS / 2).toISOString();
    expect(autoError({ decidedAt, revertedAt }, [change("client_contact.remove", skew)])).toMatchObject({ type: "REVERTED", at: revertedAt });
    expect(autoError({ decidedAt, revertedAt }, [change("client_contact.update", "2026-11-03T00:00:00Z", { role: "CEO" }, { role: "CTO" })])).toMatchObject({ type: "UPDATED", fields: ["role"] });
  });
});

describe("a replacement or a contradiction from a later source (17.11.2026)", () => {
  const decidedAt = D("2026-11-01T10:00:00Z");
  const own = { key: "S:s1", day: "2026-11-01" };
  const later = { key: "S:s2", day: "2026-11-05" };
  const at = D("2026-11-05T12:00:00Z");
  const change = (action: string, by?: { key: string; day: string } | null) => ({ action, at, before: { body: "a" }, after: { body: "b" }, by });

  it("is not an error: a later meeting brought new information", () => {
    for (const action of ["client_fact.supersede", "client_fact.contradict"]) {
      const o = autoOutcome({ decidedAt, revertedAt: null, source: own }, [change(action, later)]);
      expect(o.error).toBeNull();
      expect(o.notCounted).toEqual([{ type: action.endsWith("supersede") ? "SUPERSEDED" : "CONTRADICTED", at, reason: "NEWER_SOURCE" }]);
    }
  });

  it("is an error from the same source, even on a later day's batch", () => {
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_fact.supersede", { key: "S:s1", day: "2026-11-05" })])).toMatchObject({ type: "SUPERSEDED" });
  });

  it("is an error from an earlier or a same-day source", () => {
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_fact.supersede", { key: "S:s0", day: "2026-10-20" })])).toMatchObject({ type: "SUPERSEDED" });
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_fact.contradict", { key: "S:s3", day: "2026-11-01" })])).toMatchObject({ type: "CONTRADICTED" });
  });

  it("is an error when a person changed it on the screen, with no proposal", () => {
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_fact.supersede")])).toMatchObject({ type: "SUPERSEDED", fields: ["body"] });
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_fact.contradict", null)])).toMatchObject({ type: "CONTRADICTED" });
  });

  it("leaves a revert, a person's update and a removal as they were", () => {
    expect(autoError({ decidedAt, revertedAt: at, source: own }, [change("client_fact.supersede", later)])).toMatchObject({ type: "REVERTED" });
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_contact.update", null)])).toMatchObject({ type: "UPDATED" });
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("client_fact.remove", later)])).toMatchObject({ type: "REMOVED" });
  });

  it("28.11.2026: an update in place by an approved proposal is a replacement, by the same rule", () => {
    for (const action of ["client_contact.update", "client_organization.update", "client_entity.update", "system_access.update", "request_type.update"]) {
      const newer = autoOutcome({ decidedAt, revertedAt: null, source: own }, [change(action, later)]);
      expect(newer.error, action).toBeNull();
      expect(newer.notCounted, action).toEqual([expect.objectContaining({ type: "SUPERSEDED", reason: "NEWER_SOURCE" })]);
      expect(autoError({ decidedAt, revertedAt: null, source: own }, [change(action, { key: "S:s1", day: "2026-11-05" })]), action).toMatchObject({ type: "SUPERSEDED" });
    }
    // A person's change of a system or a request type counts too.
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("system_access.update", null)])).toMatchObject({ type: "UPDATED" });
    expect(autoError({ decidedAt, revertedAt: null, source: own }, [change("request_type.remove", null)])).toMatchObject({ type: "REMOVED" });
  });

  it("an error after a later-source replacement still counts", () => {
    const o = autoOutcome({ decidedAt, revertedAt: null, source: own }, [change("client_fact.contradict", later), { ...change("client_fact.supersede"), at: D("2026-11-08T00:00:00Z") }]);
    expect(o.error).toMatchObject({ type: "SUPERSEDED", at: D("2026-11-08T00:00:00Z") });
    expect(o.notCounted).toHaveLength(1);
  });

  it("a source's day is its own date, or the day its batch arrived in Israel", () => {
    expect(proposalSource({ id: "b1", createdAt: D("2026-11-03T08:00:00Z"), sourceId: "s1" }, { occurredAt: D("2026-11-01T00:00:00Z") })).toEqual({ key: "S:s1", day: "2026-11-01" });
    expect(proposalSource({ id: "b1", createdAt: D("2026-11-03T22:30:00Z"), sourceId: "s1" }, { occurredAt: null })).toEqual({ key: "S:s1", day: "2026-11-04" });
    expect(proposalSource({ id: "b1", createdAt: D("2026-11-03T08:00:00Z"), sourceId: null }, null)).toEqual({ key: "B:b1", day: "2026-11-03" });
    expect(isNewerSource(own, later)).toBe(true);
    expect(isNewerSource(null, later)).toBe(false);
    expect(isNewerSource(own, null)).toBe(false);
  });
});

describe("which fields were fixed", () => {
  const row = { id: "c1", clientId: "x", createdAt: "2026-11-01", updatedAt: "2026-11-01", role: "CEO", context: "  נאמר  ", channelOrder: ["mail", "phone"], sources: [{ code: "S1" }] };
  it("names only, by the same normalization as a proposal's edit, never the row's bookkeeping", () => {
    expect(changedFields(row, { ...row, updatedAt: "2026-11-09", sources: [], role: "CTO", context: "נאמר", channelOrder: ["phone", "mail"] })).toEqual(["role"]);
  });
  it("reads a contact's person as its own fields, and only fields both sides carry", () => {
    const before = { ...row, person: { id: "p", name: "Dana", emails: ["a@x.com"], phones: [] } };
    expect(changedFields(before, { ...row, person: { id: "p", name: "Dana", emails: ["b@x.com"], phones: [] } })).toEqual(["emails"]);
    // An audit row from before the person was stored after the change.
    expect(changedFields(before, { ...row, role: "CTO" })).toEqual(["role"]);
  });
  it("nothing for a removal or a row that is not one", () => {
    expect(changedFields(row, undefined)).toEqual([]);
    expect(changedFields(null, row)).toEqual([]);
  });
});

describe("the errors behind a pause, summed up", () => {
  it("counts per type in a fixed order, and the fields fixed most often, each once per error", () => {
    const s = summarizeAutoErrors([
      { type: "UPDATED", fields: ["role", "emails"] },
      { type: "REMOVED", fields: [] },
      { type: "UPDATED", fields: ["role"] },
      { type: "REVERTED", fields: [] },
    ]);
    expect(s.errors).toBe(4);
    expect(s.byType).toEqual({ REVERTED: 1, UPDATED: 2, REMOVED: 1 });
    expect(s.topFields).toEqual([
      { field: "role", count: 2 },
      { field: "emails", count: 1 },
    ]);
    expect(s.types.map((t) => [t.type, t.count, t.fields.map((f) => f.field)])).toEqual([
      ["REVERTED", 1, []],
      ["UPDATED", 2, ["role", "emails"]],
      ["REMOVED", 1, []],
    ]);
  });
  it("nothing to sum up", () => {
    expect(summarizeAutoErrors([])).toEqual({ errors: 0, byType: {}, topFields: [], types: [] });
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
