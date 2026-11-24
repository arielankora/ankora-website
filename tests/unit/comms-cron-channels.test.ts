import { describe, it, expect, vi } from "vitest";
import { runPerChannel } from "@/lib/comms/cron-channels";

// 24.11.2026: a disconnected WhatsApp number stopped the whole nightly run.
describe("runPerChannel", () => {
  const channels = [{ id: "ariel" }, { id: "anna" }, { id: "hadas" }];

  it("skips the number that fails, runs the others, and reports the failure", async () => {
    const err = new Error("Unipile החזיר שגיאה 401.");
    const run = vi.fn(async (c: { id: string }) => {
      if (c.id === "anna") throw err;
      return { chats: 1, messages: 2 };
    });
    const onFailure = vi.fn(async () => {});
    const out = await runPerChannel(channels, run, onFailure);
    expect(run).toHaveBeenCalledTimes(3);
    expect(out).toEqual([
      { channelId: "ariel", failed: false, chats: 1, messages: 2 },
      { channelId: "anna", failed: true },
      { channelId: "hadas", failed: false, chats: 1, messages: 2 },
    ]);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({ id: "anna" }, err);
  });

  it("keeps going when the alert itself fails", async () => {
    const run = vi.fn(async (c: { id: string }) => {
      if (c.id !== "hadas") throw new Error("down");
      return { chats: 0, messages: 0 };
    });
    const onFailure = vi.fn(async () => {
      throw new Error("mail down");
    });
    const out = await runPerChannel(channels, run, onFailure);
    expect(out.map((r) => r.failed)).toEqual([true, true, false]);
    expect(onFailure).toHaveBeenCalledTimes(2);
  });
});
