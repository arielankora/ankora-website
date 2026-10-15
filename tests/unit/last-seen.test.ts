import { beforeEach, describe, expect, it, vi } from "vitest";

// User.lastSeenAt: written at most once an hour per person, by a
// conditional update, after the response.

const updateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: (a: unknown) => updateMany(a) } } }));

const { LAST_SEEN_THROTTLE_MS, lastSeenWhere, shouldTouchLastSeen, touchLastSeen } = await import("@/lib/app-auth/last-seen");

const NOW = new Date("2026-10-16T09:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("shouldTouchLastSeen", () => {
  it("writes when there is no value, or it is an hour old or more", () => {
    expect(shouldTouchLastSeen(null, NOW)).toBe(true);
    expect(shouldTouchLastSeen(undefined, NOW)).toBe(true);
    expect(shouldTouchLastSeen(ago(LAST_SEEN_THROTTLE_MS), NOW)).toBe(true);
    expect(shouldTouchLastSeen(ago(3 * 24 * 3600_000), NOW)).toBe(true);
  });

  it("does not write within the hour, nor for a value from the future", () => {
    expect(shouldTouchLastSeen(ago(59 * 60_000), NOW)).toBe(false);
    expect(shouldTouchLastSeen(ago(0), NOW)).toBe(false);
    expect(shouldTouchLastSeen(new Date(NOW.getTime() + 60_000), NOW)).toBe(false);
  });
});

describe("touchLastSeen", () => {
  it("writes with the throttle repeated in the WHERE, so a race or a newer value cannot be overwritten", async () => {
    await touchLastSeen({ id: "u1", lastSeenAt: ago(2 * 3600_000) }, NOW);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "u1", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: ago(LAST_SEEN_THROTTLE_MS) } }] },
      data: { lastSeenAt: NOW },
    });
    expect(lastSeenWhere("u1", NOW)).toEqual(updateMany.mock.calls[0][0].where);
  });

  it("does not touch the database within the hour", async () => {
    await touchLastSeen({ id: "u1", lastSeenAt: ago(10 * 60_000) }, NOW);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("never throws into the request when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateMany.mockRejectedValue(new Error("db down"));
    await expect(touchLastSeen({ id: "u1", lastSeenAt: null }, NOW)).resolves.toBeUndefined();
  });
});
