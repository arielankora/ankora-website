import { describe, expect, it } from "vitest";
import { assignmentReasonError, candidatesError, itemsForClient, waitingItemLine } from "@/lib/batch-assignment";

// "ממתין לשיוך" (spec 5.1, step 3): what a waiting batch may be, and what
// travels when a person picks a client other than the one Claude proposed.

describe("batch assignment", () => {
  it("is a question between two clients or more, the proposed one among them", () => {
    expect(candidatesError("a", ["a", "b"])).toBeNull();
    expect(candidatesError("a", ["b", "c"])).toMatch("אחד המועמדים");
    expect(candidatesError("a", ["a", "a"])).toMatch("שני לקוחות");
    expect(candidatesError("a", ["a", "b", "c", "d", "e", "f", "g"])).toMatch("עד 6");
  });

  it("needs a reason", () => {
    expect(assignmentReasonError("  ")).toMatch("למה");
    expect(assignmentReasonError("הכותרת מזכירה את מכרז האחסון של NUX")).toBeNull();
    expect(assignmentReasonError("x".repeat(501))).toMatch("500");
  });

  it("to the proposed client, everything travels; to another, nothing that points into the proposed file", () => {
    type Item = { target: "FACT"; action?: string; targetId?: string | null; alsoSources?: string[]; payload: Record<string, unknown> };
    const items: { index: number; item: Item }[] = [
      { index: 0, item: { target: "FACT", payload: { kind: "NOTE", body: "א" }, alsoSources: ["S2"] } },
      { index: 1, item: { target: "FACT", action: "SUPERSEDE", targetId: "f1", payload: { kind: "NOTE", body: "ב" } } },
    ];
    expect(itemsForClient(items, true)).toEqual({ items: items.map((i) => i.item), indexes: [0, 1], dropped: [] });
    const other = itemsForClient(items, false);
    expect(other.items).toEqual([{ target: "FACT", payload: { kind: "NOTE", body: "א" }, alsoSources: [], targetId: null }]);
    expect(other.indexes).toEqual([0]);
    expect(other.dropped).toEqual([{ index: 1, reason: expect.stringContaining("לקוח אחר") }]);
  });

  it("a waiting item shows a line, and a sensitive one only that it is there", () => {
    expect(waitingItemLine("FACT", { kind: "NOTE", body: "המכרז נסגר ב-1.11" })).toContain("המכרז נסגר");
    const sensitive = waitingItemLine("FACT", { kind: "NOTE", body: "אבחנה רפואית", sensitivity: "SENSITIVE" });
    expect(sensitive).toContain("פריט רגיש");
    expect(sensitive).not.toContain("אבחנה");
  });
});
