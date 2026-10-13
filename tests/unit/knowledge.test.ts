import { describe, it, expect } from "vitest";
import { canSeeKnowledgeItem, effectiveStatus, parseFieldStatus } from "@/lib/knowledge";

// Org-brain spec 3.1 (13.10.2026).

describe("effectiveStatus: an item is as strong as its weakest field", () => {
  it("a confirmed entity with a missing registration number reads missing", () => {
    expect(effectiveStatus("CONFIRMED", { registrationNumber: { status: "MISSING" } })).toBe("MISSING");
  });
  it("uncertain beats confirmed, missing beats uncertain", () => {
    expect(effectiveStatus("CONFIRMED", { email: { status: "UNCERTAIN" } })).toBe("UNCERTAIN");
    expect(effectiveStatus("UNCERTAIN", { a: { status: "UNCERTAIN" }, b: { status: "MISSING" } })).toBe("MISSING");
  });
  it("no field statuses keep the item's own", () => {
    expect(effectiveStatus("UNCERTAIN", {})).toBe("UNCERTAIN");
  });
  it("superseded stays superseded", () => {
    expect(effectiveStatus("SUPERSEDED", { a: { status: "MISSING" } })).toBe("SUPERSEDED");
  });
});

describe("parseFieldStatus: stored JSON is not trusted", () => {
  it("keeps well-formed entries only", () => {
    expect(
      parseFieldStatus({ email: { status: "UNCERTAIN", toResolve: " לשאול " }, phone: { status: "CONFIRMED" }, x: "junk" })
    ).toEqual({ email: { status: "UNCERTAIN", toResolve: "לשאול" } });
  });
  it("anything else is empty", () => {
    expect(parseFieldStatus(null)).toEqual({});
    expect(parseFieldStatus([1, 2])).toEqual({});
  });
});

describe("canSeeKnowledgeItem", () => {
  const viewer = { id: "u1", isManager: false };
  it("everyone sees ALL_STAFF", () => {
    expect(canSeeKnowledgeItem({ audience: "ALL_STAFF", audienceUserIds: [] }, viewer, null)).toBe(true);
  });
  it("ACCOUNT_TEAM: the account manager and the named", () => {
    expect(canSeeKnowledgeItem({ audience: "ACCOUNT_TEAM", audienceUserIds: [] }, viewer, "u1")).toBe(true);
    expect(canSeeKnowledgeItem({ audience: "ACCOUNT_TEAM", audienceUserIds: [] }, viewer, "u2")).toBe(false);
    expect(canSeeKnowledgeItem({ audience: "ACCOUNT_TEAM", audienceUserIds: ["u1"] }, viewer, "u2")).toBe(true);
  });
  it("RESTRICTED: only the named, even for the account manager", () => {
    expect(canSeeKnowledgeItem({ audience: "RESTRICTED", audienceUserIds: [] }, viewer, "u1")).toBe(false);
    expect(canSeeKnowledgeItem({ audience: "RESTRICTED", audienceUserIds: ["u1"] }, viewer, null)).toBe(true);
  });
  it("managers see everything", () => {
    expect(canSeeKnowledgeItem({ audience: "RESTRICTED", audienceUserIds: [] }, { id: "m", isManager: true }, null)).toBe(true);
  });
});
