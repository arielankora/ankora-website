import { afterEach, describe, expect, it, vi } from "vitest";
import { afterResponse } from "@/lib/after-response";

// afterResponse defers best-effort follow-up work past the response.
//
// The interesting behaviour is the FALLBACK, and it is the one these
// tests can actually observe: outside a request there is nothing to come
// after, Next's `after` throws, and the work has to run inline and be
// waited for. A cron or a script that returned before its own side
// effects had run would have quietly stopped doing its job - and the
// integration suite, which calls these domain functions directly, would
// have started asserting against work that had not happened yet.
//
// So: no request scope here means every test below exercises the inline
// path, which is exactly the path that must not regress.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("afterResponse outside a request scope", () => {
  it("runs the work, and does not return until it has finished", async () => {
    const order: string[] = [];

    await afterResponse("test", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("work");
    });
    order.push("after");

    // "work" before "after" is the whole assertion: a fire-and-forget
    // implementation would push them the other way round, and a cron
    // would return having started its side effects rather than done
    // them.
    expect(order).toEqual(["work", "after"]);
  });

  it("swallows a failure and logs it, rather than failing the caller", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // The caller is a mutation that has already committed. A follow-up
    // that throws must not turn a successful write into an error the
    // user sees - that is what "best-effort" has to mean, and it is the
    // reason every one of these call sites had a .catch on it before.
    await expect(
      afterResponse("alerts", async () => {
        throw new Error("threshold lookup exploded");
      }),
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledTimes(1);
    const [message, err] = logged.mock.calls[0];
    // The label is in the message so a log line says which follow-up
    // failed, not just that one did.
    expect(String(message)).toContain("alerts");
    expect((err as Error).message).toBe("threshold lookup exploded");
  });

  it("swallows a synchronous throw from the work function too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // `() => { throw }` never produces a promise, so a bare
    // `work().catch(...)` would let it escape. Easy to get wrong, and
    // the failure lands on a user whose write actually succeeded.
    await expect(
      afterResponse("sync", () => {
        throw new Error("thrown before any await");
      }),
    ).resolves.toBeUndefined();
  });
});
