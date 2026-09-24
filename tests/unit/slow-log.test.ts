import { afterEach, describe, expect, it, vi } from "vitest";
import { timed } from "@/lib/slow-log";

// The diagnostic's own contract.
//
// lib/slow-log.ts makes three promises that are easy to break by
// accident and impossible to notice when they are broken: it costs
// nothing on a healthy path, it says what it was working on when it
// complains, and it never replaces a real error with one of its own.
//
// None of those are visible on a screen, which is exactly why they need
// a test. A diagnostic that quietly stops diagnosing is worse than none,
// because the next investigation starts by trusting it.

/// The threshold in lib/slow-log.ts. Stated once here rather than
/// imported, because a test that reads the constant it is testing agrees
/// with the code by construction and would keep passing if the number
/// moved to something absurd.
const SLOW_MS = 750;

function clockThatJumps(by: number) {
  let first = true;
  return vi.spyOn(Date, "now").mockImplementation(() => {
    if (first) {
      first = false;
      return 0;
    }
    return by;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a fast call says nothing, and costs nothing", () => {
  it("does not log, and does not build the detail string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const detail = vi.fn(() => "should never be built");
    clockThatJumps(SLOW_MS - 1);

    const value = await timed("fast.thing", async () => 42, detail);

    expect(value).toBe(42);
    expect(warn).not.toHaveBeenCalled();
    // The point of `detail` being a function rather than a string. A
    // caller is meant to be able to count rows in it without paying for
    // the count on every healthy request.
    expect(detail).not.toHaveBeenCalled();
  });
});

describe("a slow call says how long, and on how much", () => {
  it("carries the detail, built from the result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockThatJumps(SLOW_MS);

    await timed(
      "screen.tasks.load",
      async () => ["a", "b", "c"],
      (rows) => `${rows?.length ?? 0} rows`
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain("screen.tasks.load");
    expect(line).toContain(`${SLOW_MS}ms`);
    // Without this the line cannot tell a slow query from a large answer,
    // which are opposite problems with opposite fixes.
    expect(line).toContain("3 rows");
  });

  it("still logs without a detail, because most callers have nothing to add", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockThatJumps(SLOW_MS + 500);

    await timed("plain.thing", async () => undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("plain.thing");
  });
});

describe("the diagnostic never becomes the problem", () => {
  it("rethrows the real error, and marks the line as a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockThatJumps(SLOW_MS + 1);

    await expect(
      timed("failing.thing", async () => {
        throw new Error("the actual failure");
      })
    ).rejects.toThrow("the actual failure");

    expect(warn.mock.calls[0][0]).toContain("(threw)");
  });

  it("does not let a broken detail replace the error it was reporting on", async () => {
    // The nightmare this guards against: a query fails, the detail tries
    // to count rows it was never given, and the person debugging is
    // handed "Cannot read properties of undefined" instead of the
    // database error that actually happened.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clockThatJumps(SLOW_MS + 1);

    await expect(
      timed(
        "failing.thing",
        async () => {
          throw new Error("the actual failure");
        },
        (rows) => `${(rows as string[]).length} rows`
      )
    ).rejects.toThrow("the actual failure");

    expect(warn.mock.calls[0][0]).toContain("(detail threw)");
  });
});
