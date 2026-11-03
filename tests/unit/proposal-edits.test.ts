import { describe, expect, it } from "vitest";
import {
  canonicalValue,
  classifyFieldEdit,
  proposalEditDiff,
  proposalEditKind,
  readEditKind,
  summarizeProposalEdit,
  textSimilarity,
} from "@/lib/proposal-edits";

// What a person changed in a proposal before approving it, and whether the
// change was to the wording or to a fact (3.11.2026). Under test:
//
//   1. The diff: only fields whose value changed, with spaces, empty
//      strings, a missing clientVisible and the order of a list not counted.
//   2. The classifier: free text reworded closely with the same numbers is
//      WORDING; everything else is a FACT.
//   3. The kind of the whole edit: null, WORDING, FACT, or MIXED.

describe("proposalEditDiff", () => {
  it("returns only the fields that changed, with their values as they were", () => {
    const diff = proposalEditDiff(
      { name: "שני הלוי", role: "VP Finance", emails: ["a@x.co"], knowledgeStatus: "CONFIRMED" },
      { name: "שני הלוי", role: "סמנכ״לית כספים", emails: ["a@x.co"], knowledgeStatus: "CONFIRMED" }
    );
    expect(diff).toEqual([{ field: "role", before: "VP Finance", after: "סמנכ״לית כספים" }]);
  });

  it("does not count spaces, an empty string for nothing, or a missing clientVisible", () => {
    expect(
      proposalEditDiff(
        { body: "WhatsApp,  אחר כך Slack\n", notes: null, clientVisible: undefined },
        { body: " WhatsApp, אחר כך Slack", notes: "", clientVisible: false }
      )
    ).toEqual([]);
    expect(proposalEditDiff({}, { clientVisible: true }).map((d) => d.field)).toEqual(["clientVisible"]);
  });

  it("reads a list as a set: a new order is no change, a new item is", () => {
    expect(proposalEditDiff({ emails: ["a@x.co", "b@x.co"] }, { emails: ["b@x.co", "a@x.co"] })).toEqual([]);
    expect(proposalEditDiff({ emails: ["a@x.co"] }, { emails: ["a@x.co", "b@x.co"] }).map((d) => d.field)).toEqual(["emails"]);
    expect(proposalEditDiff({ refs: [{ system: "RAID", id: "1" }] }, { refs: [{ id: "1", system: "RAID" }] })).toEqual([]);
  });

  it("ignores the sources, and lists added and cleared fields", () => {
    const diff = proposalEditDiff({ sources: [{ code: "S1" }], title: "x", notes: "y" }, { sources: [{ code: "S2" }], title: "x", toResolve: "z" });
    expect(diff.map((d) => d.field)).toEqual(["notes", "toResolve"]);
    expect(diff[0]).toEqual({ field: "notes", before: "y", after: null });
  });

  it("canonicalValue: an empty list or object is nothing", () => {
    expect(canonicalValue([])).toBeNull();
    expect(canonicalValue({ a: "" })).toBeNull();
    expect(canonicalValue(0)).toBe(0);
    expect(canonicalValue(false)).toBe(false);
  });
});

describe("classifyFieldEdit", () => {
  it("a free-text field reworded closely, with the same numbers, is WORDING", () => {
    expect(classifyFieldEdit("body", "מגבלת Justworks: 25,000$ להעברה", "מגבלת Justworks היא 25,000$ להעברה אחת")).toBe("WORDING");
    expect(classifyFieldEdit("title", "Monthly payroll review", "Monthly payroll reveiw")).toBe("WORDING");
    expect(classifyFieldEdit("handling", "Send the report to Dana", "send the report to Dana.")).toBe("WORDING");
  });

  it("a changed number in free text is a FACT, however close it reads", () => {
    expect(classifyFieldEdit("body", "מגבלת Justworks: 25,000$ להעברה", "מגבלת Justworks: 50,000$ להעברה")).toBe("FACT");
    expect(classifyFieldEdit("statement", "Payroll is sent on the 10th", "Payroll is sent on the 15th")).toBe("FACT");
  });

  it("free text rewritten into something else, added or cleared, is a FACT", () => {
    expect(classifyFieldEdit("body", "Guy is leaving in December", "The CFO approves every vendor payment")).toBe("FACT");
    expect(classifyFieldEdit("notes", null, "Only by phone")).toBe("FACT");
    expect(classifyFieldEdit("notes", "Only by phone", null)).toBe("FACT");
  });

  it("any change to a field that holds a fact is a FACT", () => {
    for (const field of ["name", "role", "emails", "phones", "kind", "date", "dayOfMonth", "billingCost", "amount", "validUntil", "decidedAt", "recurrence", "targetId", "clientVisible", "knowledgeStatus", "somethingNew"]) {
      expect(classifyFieldEdit(field, "Guy Cohen", "Guy Cohen.")).toBe("FACT");
    }
  });
});

describe("textSimilarity", () => {
  it("is 1 for the same text and falls with the distance", () => {
    expect(textSimilarity("abc", "abc")).toBe(1);
    expect(textSimilarity("abcd", "abce")).toBe(0.75);
    expect(textSimilarity("", "abc")).toBe(0);
  });

  it("compares long texts by words", () => {
    const long = "word ".repeat(600).trim();
    expect(textSimilarity(long, `${long} more`)).toBeGreaterThan(0.99);
  });
});

describe("proposalEditKind and summarizeProposalEdit", () => {
  it("null when nothing changed, one kind, or MIXED", () => {
    expect(proposalEditKind([])).toBeNull();
    expect(proposalEditKind(["WORDING", "WORDING"])).toBe("WORDING");
    expect(proposalEditKind(["FACT"])).toBe("FACT");
    expect(proposalEditKind(["WORDING", "FACT"])).toBe("MIXED");
  });

  it("summarizes a diff with its kinds and its values before and after", () => {
    const s = summarizeProposalEdit(
      { title: "Payroll review", date: "2026-11-10", notes: "x" },
      { title: "Payroll  reviews", date: "2026-11-12", notes: "x" }
    );
    expect(s).toEqual({
      editedFields: ["date", "title"],
      fieldKinds: { date: "FACT", title: "WORDING" },
      editKind: "MIXED",
      before: { date: "2026-11-10", title: "Payroll review" },
      after: { date: "2026-11-12", title: "Payroll  reviews" },
    });
    expect(summarizeProposalEdit({ a: 1 }, { a: 1 })).toMatchObject({ editedFields: [], editKind: null });
  });

  it("readEditKind accepts only the three kinds", () => {
    expect(readEditKind("MIXED")).toBe("MIXED");
    expect(readEditKind("wording")).toBeNull();
    expect(readEditKind(undefined)).toBeNull();
  });
});
