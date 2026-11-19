import { describe, expect, it } from "vitest";
import { explicitMineParam, mineFilters, mineParam, parseMineScope, resolveMineScope } from "@/app/(product)/app/(authenticated)/tasks/mine-scope";

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

// Ariel, 19.11.2026: "לביצוע" kept falling back to "שלי". The last
// choice is remembered, the same rule as the list / board switch.
describe("the remembered mine scope", () => {
  it("opens on שלי when nothing says otherwise", () => {
    expect(resolveMineScope(undefined, undefined)).toBe("involved");
  });

  it("brings back the last choice when the address is bare", () => {
    expect(resolveMineScope(undefined, "assigned")).toBe("assigned");
    expect(resolveMineScope("", "supervising")).toBe("supervising");
    expect(resolveMineScope(undefined, "all")).toBe("all");
  });

  it("lets the address win over what was remembered", () => {
    expect(resolveMineScope("1", "assigned")).toBe("involved");
    expect(resolveMineScope("supervising", "assigned")).toBe("supervising");
    expect(resolveMineScope("0", "assigned")).toBe("all");
  });

  it("ignores a remembered value it does not know", () => {
    expect(resolveMineScope(undefined, "0")).toBe("involved");
    expect(resolveMineScope(undefined, ["assigned"])).toBe("involved");
  });

  it("writes every scope out loud, so a link never falls back to the remembered one", () => {
    for (const scope of ["involved", "assigned", "supervising", "all"] as const) {
      expect(explicitMineParam(scope)).toBeTruthy();
      expect(resolveMineScope(explicitMineParam(scope), "assigned")).toBe(scope);
    }
  });
});
