import { describe, expect, it } from "vitest";
import { bulkApproveBlocker } from "@/lib/knowledge-proposals";

// "ממתין לאישור" (spec 5.2): which proposals may be approved together.

describe("bulkApproveBlocker", () => {
  const p = { action: "CREATE" as const, flags: [], payload: {} };
  it("a new item with no warning may be approved with others", () => {
    expect(bulkApproveBlocker(p)).toBeNull();
    // An Ankora source or a proposed rule: information, not a reason to wait.
    expect(bulkApproveBlocker({ ...p, flags: [{ code: "R14", message: "" }, { code: "POLICY", message: "" }] })).toBeNull();
  });
  it("what changes an existing item, may already be there, or is sensitive, one at a time", () => {
    expect(bulkApproveBlocker({ ...p, action: "SUPERSEDE" })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, action: "CONTRADICT" })).toContain("בתיק");
    expect(bulkApproveBlocker({ ...p, flags: [{ code: "DUPLICATE", message: "" }] })).toContain("כבר");
    expect(bulkApproveBlocker({ ...p, payload: { sensitivity: "SENSITIVE" } })).toContain("רגיש");
  });
});
