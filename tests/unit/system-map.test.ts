import { describe, expect, it } from "vitest";
import { isAccessGap, SYSTEM_ACCESS_STATUS_LABELS } from "@/lib/system-map";

describe("system map gaps", () => {
  it("counts pending and no access as gaps, and nothing else", () => {
    expect(isAccessGap("PENDING")).toBe(true);
    expect(isAccessGap("NO_ACCESS")).toBe(true);
    expect(isAccessGap("HAS_ACCESS")).toBe(false);
    // A system the client keeps to themselves is not a gap.
    expect(isAccessGap("NOT_NEEDED")).toBe(false);
  });

  it("has a Hebrew label for every status", () => {
    expect(Object.values(SYSTEM_ACCESS_STATUS_LABELS).every((l) => l.length > 0)).toBe(true);
  });
});
