import { describe, expect, it } from "vitest";
import { COMMS_CRON_DEADLINE_MS, COMMS_CRON_STEPS, perChannelShare, stepBudget } from "@/lib/comms/cron-budget";

describe("nightly communications run budget", () => {
  it("gives a step its share while there is time", () => {
    expect(stepBudget(60_000, 0, 10_000)).toBe(60_000);
  });

  it("cuts a step to what is left before the deadline", () => {
    expect(stepBudget(60_000, 0, COMMS_CRON_DEADLINE_MS - 15_000)).toBe(15_000);
  });

  it("gives nothing after the deadline", () => {
    expect(stepBudget(60_000, 0, COMMS_CRON_DEADLINE_MS + 1)).toBe(0);
  });

  it("splits the WhatsApp share between the stored numbers", () => {
    expect(perChannelShare(0)).toBe(0);
    expect(perChannelShare(1)).toBe(COMMS_CRON_STEPS.whatsapp);
    expect(perChannelShare(3) * 3).toBeLessThanOrEqual(COMMS_CRON_STEPS.whatsapp);
  });

  it("leaves room under Vercel's 300 seconds", () => {
    const sum = Object.values(COMMS_CRON_STEPS).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(COMMS_CRON_DEADLINE_MS);
    expect(COMMS_CRON_DEADLINE_MS).toBeLessThanOrEqual(240_000);
  });
});
