import { describe, expect, it } from "vitest";
import { carryQuery } from "@/components/app/ViewTabs";

// The redirects from the old addresses (19.10.2026): /app/my-time,
// /app/report-schedules and /app/portal/monthly. The monthly one is in
// clients' emails, so the month it names has to survive the trip.
describe("carryQuery", () => {
  it("keeps the view's own keys and adds the tab", () => {
    expect(carryQuery({ monthOffset: "-2" }, ["monthOffset"], { view: "monthly" })).toBe("view=monthly&monthOffset=-2");
    expect(carryQuery({ week: "2026-10-12" }, ["week"], { tab: "mine" })).toBe("tab=mine&week=2026-10-12");
    expect(carryQuery({ clientId: "c1" }, ["clientId"], { tab: "schedules" })).toBe("tab=schedules&clientId=c1");
  });

  it("drops everything else, repeated keys and oversized values", () => {
    expect(carryQuery({ week: "x", next: "https://evil.test" }, ["week"], { tab: "mine" })).toBe("tab=mine&week=x");
    expect(carryQuery({ week: ["a", "b"] }, ["week"], { tab: "mine" })).toBe("tab=mine");
    expect(carryQuery({ week: "a".repeat(201) }, ["week"], { tab: "mine" })).toBe("tab=mine");
    expect(carryQuery({}, ["week"], { tab: "mine" })).toBe("tab=mine");
  });

  it("lets the target's own key win over one smuggled in under the same name", () => {
    expect(carryQuery({ tab: "x", week: "w" }, ["week"], { tab: "mine" })).toBe("tab=mine&week=w");
  });
});
