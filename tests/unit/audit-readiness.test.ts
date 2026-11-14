import { describe, expect, it } from "vitest";
import { auditReadiness, listNumbers, staleReasons } from "@/lib/audit-readiness";

// The procedure document's tab (14.11.2026, processes redesign, stage 4).

const base = {
  scope: null,
  controlRefs: ["CC6.2", "CC6.3"],
  classification: "CONFIDENTIAL",
  steps: [{ evidence: "קובץ" }, { evidence: null }, { verification: "מסך" }, {}, { evidence: "" }],
  docMissing: [{ field: "approval", label: "ספי אישור ומאשר" }],
  translation: "draft" as const,
  runs: { closed: 14, withEvidence: 14 },
  strangerOpen: 0,
};

describe("audit readiness", () => {
  it("lists what is in order, then what is missing, and counts the missing", () => {
    const r = auditReadiness(base);
    expect(r.items.map((i) => [i.key, i.ok])).toEqual([
      ["controls", true],
      ["classification", true],
      ["scope", false],
      ["evidence", false],
      ["doc:approval", false],
      ["translation", false],
      ["runs", true],
    ]);
    expect(r.missing).toBe(4);
    expect(r.items.find((i) => i.key === "evidence")?.text).toEqual({ key: "evidenceMissing", values: { list: "2, 4 ו-5", form: "other" } });
    expect(r.items.find((i) => i.key === "doc:approval")).toMatchObject({ action: "work", field: "approval" });
  });

  it("is ready when nothing is missing", () => {
    const r = auditReadiness({ ...base, scope: "כל העובדים", steps: [{ evidence: "x" }], docMissing: [], translation: "approved" });
    expect(r.missing).toBe(0);
  });

  it("names step numbers in Hebrew", () => {
    expect(listNumbers([2])).toBe("2");
    expect(listNumbers([2, 5])).toBe("2 ו-5");
  });
});

describe("stale reasons", () => {
  const approvedAt = new Date("2026-11-10T10:00:00Z");
  it("says why the approved document is out of date, and nothing without one", () => {
    expect(
      staleReasons({
        approvedAt,
        approverLeft: [{ step: 4, name: "גיא", at: "2026-11-15" }],
        rhythmChangedAt: new Date("2026-11-12T10:00:00Z"),
        rules: [
          { title: "אישור העברות ב-Mercury", updatedAt: new Date("2026-11-12T08:00:00Z") },
          { title: "ישן", updatedAt: new Date("2026-11-01T08:00:00Z") },
        ],
      }).map((r) => r.key)
    ).toEqual(["approverLeft", "rhythmChanged", "ruleChanged"]);
    expect(staleReasons({ approvedAt: null, approverLeft: [{ step: 1, name: "x" }], rhythmChangedAt: null, rules: [] })).toEqual([]);
    expect(staleReasons({ approvedAt, approverLeft: [], rhythmChangedAt: new Date("2026-11-01T00:00:00Z"), rules: [] })).toEqual([]);
  });
});
