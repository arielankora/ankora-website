import { describe, expect, it } from "vitest";
import { mineFilters, mineParam, parseMineScope } from "@/app/(product)/app/(authenticated)/tasks/mine-scope";

// Ariel, 15.10.2026: "שלי" can be split into the tasks I carry and the
// tasks I supervise. One URL key, so links from before today keep working.
describe("the tasks screen's mine scope", () => {
  it("keeps every older link's meaning", () => {
    expect(parseMineScope(undefined)).toBe("involved");
    expect(parseMineScope("1")).toBe("involved");
    expect(parseMineScope("0")).toBe("all");
  });

  it("reads each half", () => {
    expect(parseMineScope("assigned")).toBe("assigned");
    expect(parseMineScope("supervising")).toBe("supervising");
  });

  it("lands an unknown value on the default, not on everyone's work", () => {
    expect(parseMineScope("whatever")).toBe("involved");
  });

  it("round-trips, with the default written as nothing", () => {
    for (const scope of ["involved", "assigned", "supervising", "all"] as const) {
      expect(parseMineScope(mineParam(scope))).toBe(scope);
    }
    expect(mineParam("involved")).toBeUndefined();
  });

  it("sets exactly one person filter, and none for everyone's work", () => {
    expect(mineFilters("involved", "me")).toEqual({ involvedUserId: "me" });
    expect(mineFilters("assigned", "me")).toEqual({ assignedToId: "me" });
    expect(mineFilters("supervising", "me")).toEqual({ supervisorId: "me" });
    expect(mineFilters("all", "me")).toEqual({});
  });
});
