import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COMMS_CRON_DEADLINE_MS, COMMS_CRON_MAX_DURATION_S, COMMS_CRON_STEPS, nextChannelShare, stepBudget } from "@/lib/comms/cron-budget";

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

  // 27.11.2026: each number takes an even part of what is left before the
  // deadline, so what a finished number does not use goes to the next.
  it("splits what is left before the deadline between the numbers still to run", () => {
    expect(nextChannelShare(0, 0, 0)).toBe(0);
    const sumBefore = COMMS_CRON_STEPS.reconcile + COMMS_CRON_STEPS.transcribe + COMMS_CRON_STEPS.driveCopies;
    // The steps before it used all their time: at least the WhatsApp share.
    expect(nextChannelShare(1, 0, sumBefore)).toBeGreaterThanOrEqual(COMMS_CRON_STEPS.whatsapp);
    expect(nextChannelShare(3, 0, sumBefore) * 3).toBeLessThanOrEqual(COMMS_CRON_DEADLINE_MS - sumBefore);
    // Five numbers at 200 seconds: the first gets a fifth of 400; a number
    // that used 5 seconds of its 80 leaves the next a quarter of 395.
    expect(nextChannelShare(5, 0, 200_000)).toBe(80_000);
    expect(nextChannelShare(4, 0, 205_000)).toBe(98_750);
    expect(nextChannelShare(2, 0, COMMS_CRON_DEADLINE_MS + 1)).toBe(0);
  });

  // 27.11.2026: 800 seconds on Vercel Pro, and a deadline that leaves room
  // for one item (a long recording, about three minutes) to run over it.
  it("leaves room under the route's maxDuration", () => {
    const sum = Object.values(COMMS_CRON_STEPS).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(COMMS_CRON_DEADLINE_MS);
    expect(COMMS_CRON_MAX_DURATION_S * 1000 - COMMS_CRON_DEADLINE_MS).toBeGreaterThanOrEqual(180_000);
    expect(COMMS_CRON_MAX_DURATION_S).toBeLessThanOrEqual(800);
  });

  it("matches the route's maxDuration, which Next reads as a literal", () => {
    const route = readFileSync("app/api/cron/comms-recordings/route.ts", "utf8");
    expect(route).toContain(`export const maxDuration = ${COMMS_CRON_MAX_DURATION_S};`);
  });

  it("transcribes and copies what is stored before loading WhatsApp history", () => {
    expect(Object.keys(COMMS_CRON_STEPS)).toEqual(["reconcile", "transcribe", "driveCopies", "whatsapp"]);
    const route = readFileSync("app/api/cron/comms-recordings/route.ts", "utf8");
    const at = (step: string) => route.indexOf(`timed("${step}"`);
    expect(at("transcribe")).toBeLessThan(at("whatsapp"));
    expect(at("driveCopies")).toBeLessThan(at("whatsapp"));
  });
});
