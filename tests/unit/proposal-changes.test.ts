import { describe, expect, it } from "vitest";
import { changesForAi, noChangeReason, proposalChanges } from "@/lib/proposal-changes";

// 19.11.2026: an update to Haim Oliel (S7) came as an empty headline under
// his struck-out name. The card now shows what changes, before and after.

const haim = { name: "חיים אוליאל", role: null, context: null, knowledgeStatus: "CONFIRMED", toResolve: null, emails: [], phones: ["+972501234567"], organizationName: null };

describe("proposalChanges", () => {
  it("lists only the fields that change, with what the file says now", () => {
    const changes = proposalChanges({ role: "רואה החשבון של מאיה", context: "מלווה את מאיה 6 שנים", knowledgeStatus: "CONFIRMED", sources: [{ code: "S7" }] }, haim);
    expect(changes).toEqual([
      { field: "role", before: null, beforeKnown: true, after: "רואה החשבון של מאיה" },
      { field: "context", before: null, beforeKnown: true, after: "מלווה את מאיה 6 שנים" },
    ]);
  });

  it("compares text trimmed and lists in any order", () => {
    expect(proposalChanges({ name: " חיים אוליאל ", phones: ["+972501234567"] }, haim)).toEqual([]);
    expect(proposalChanges({ emails: ["b@x.com", "a@x.com"] }, { emails: ["a@x.com", "b@x.com"] })).toEqual([]);
  });

  it("says a name the file keeps by id was not read, and skips an empty one", () => {
    expect(proposalChanges({ systemNames: ["Priority"], approverName: null }, {})).toEqual([{ field: "systemNames", before: null, beforeKnown: false, after: ["Priority"] }]);
  });

  it("shows a cleared field as cleared, and amounts in whole units", () => {
    expect(proposalChanges({ role: null, monthlyCostMinor: 12000 }, { role: "יועץ", monthlyCostMinor: 10000 })).toEqual([
      { field: "role", before: "יועץ", beforeKnown: true, after: null },
      { field: "monthlyCostMinor", before: 100, beforeKnown: true, after: 120 },
    ]);
  });
});

describe("noChangeReason", () => {
  it("refuses an update that changes nothing", () => {
    expect(noChangeReason({ name: "חיים אוליאל", knowledgeStatus: "CONFIRMED" }, haim)).toContain("לא משנה אף שדה");
  });

  it("refuses an update that only marks the item uncertain with a question", () => {
    expect(noChangeReason({ knowledgeStatus: "UNCERTAIN", toResolve: "לשאול את מאיה אם הוא רואה החשבון" }, haim)).toContain("QUESTION");
  });

  it("lets through an update that changes something", () => {
    expect(noChangeReason({ role: "רואה חשבון", knowledgeStatus: "CONFIRMED" }, haim)).toBeNull();
    expect(noChangeReason({ role: "רואה חשבון", knowledgeStatus: "UNCERTAIN", toResolve: "לוודא" }, haim)).toBeNull();
  });
});

describe("changesForAi", () => {
  it("words fields and values in Hebrew for Claude", () => {
    const changes = proposalChanges({ role: "רואה חשבון", knowledgeStatus: "UNCERTAIN", isPrimary: true, systemNames: ["Priority"] }, { ...haim, isPrimary: false });
    expect(changesForAi(changes)).toEqual([
      { field: "תפקיד", before: "לא כתוב", after: "רואה חשבון" },
      { field: "סטטוס", before: "ודאי", after: "לא ודאי" },
      { field: "איש קשר ראשי", before: "לא", after: "כן" },
      { field: "מערכות", before: "לא נבדק כאן", after: "Priority" },
    ]);
  });
});

describe("a contact's leaving day (19.11.2026)", () => {
  it("is a change against the day in the file, and a detail on a new contact", async () => {
    const { proposalDetailParts } = await import("@/lib/knowledge-proposals");
    expect(proposalChanges({ endedAt: "2027-06-30" }, { endedAt: new Date("2027-06-30T12:00:00Z") })).toEqual([]);
    expect(proposalChanges({ endedAt: "2027-06-30" }, { endedAt: null })).toEqual([{ field: "endedAt", before: null, beforeKnown: true, after: "2027-06-30" }]);
    expect(proposalDetailParts("CONTACT", { name: "חיים", endedAt: "2027-06-30" })).toContainEqual({ kind: "key", key: "endedAt", values: { date: "2027-06-30" } });
  });
});
