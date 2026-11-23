import { describe, expect, it } from "vitest";
import { isPendingUpdateStale, PENDING_UPDATE_DAYS } from "@/lib/agents/pending-update";

const DAY = 24 * 3600_000;
const now = new Date("2026-11-23T08:00:00Z");

describe("an agent update waiting for its owner", () => {
  it("reaches the morning digest after 7 days, not before", () => {
    expect(PENDING_UPDATE_DAYS).toBe(7);
    expect(isPendingUpdateStale(new Date(now.getTime() - 7 * DAY), now)).toBe(true);
    expect(isPendingUpdateStale(new Date(now.getTime() - 7 * DAY + 60_000), now)).toBe(false);
    expect(isPendingUpdateStale(new Date(now.getTime() - DAY), now)).toBe(false);
  });

  it("is not stale without a date", () => {
    expect(isPendingUpdateStale(null, now)).toBe(false);
  });
});
