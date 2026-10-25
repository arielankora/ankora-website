import { describe, expect, it } from "vitest";
import { measures, metricsReport } from "@/lib/brain-metrics";

const now = new Date("2026-10-20T09:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const empty = { processes: [], uncertainSince: [], systems: [], autoTasks: [], runs: [], pendingProposalsSince: [], decidedBatches: [] };
const byKey = (ms: ReturnType<typeof measures>) => Object.fromEntries(ms.map((m) => [m.key, m]));

describe("the measures of spec section 11", () => {
  it("says there is nothing to measure rather than a zero", () => {
    const m = byKey(measures(empty, now));
    expect(m.completeness).toMatchObject({ state: "none", display: "אין עדיין" });
    expect(m.oldestProposal.state).toBe("none");
    expect(m.staleUncertain).toMatchObject({ value: 0, state: "ok" });
  });

  it("counts each one against its first target", () => {
    const m = byKey(
      measures(
        {
          processes: [
            { status: "ACTIVE", transitionStatus: "WITH_ANKORA", backupOwnerId: "b", ready: true, documentation: 1 },
            { status: "ACTIVE", transitionStatus: "IN_HANDOVER", backupOwnerId: null, ready: false, documentation: 0.5 },
            { status: "ACTIVE", transitionStatus: "NOT_PLANNED", backupOwnerId: "b", ready: true, documentation: 0.9 },
            { status: "RETIRED", transitionStatus: "WITH_ANKORA", backupOwnerId: null, ready: false, documentation: 0 },
          ],
          uncertainSince: [daysAgo(20), daysAgo(3)],
          systems: [{ accessStatus: "HAS_ACCESS" }, { accessStatus: "PENDING" }, { accessStatus: "NOT_NEEDED" }],
          autoTasks: [{ processId: "p" }, { processId: null }, { processId: "p" }],
          runs: [
            { dueDate: new Date("2026-10-10T00:00:00Z"), completedAt: new Date("2026-10-10T18:00:00Z") },
            { dueDate: new Date("2026-10-10T00:00:00Z"), completedAt: new Date("2026-10-12T08:00:00Z") },
          ],
          pendingProposalsSince: [daysAgo(4), daysAgo(1)],
          decidedBatches: [
            { firstDecidedAt: daysAgo(2), lastDecidedAt: new Date(daysAgo(2).getTime() + 3 * 60_000) },
            { firstDecidedAt: daysAgo(1), lastDecidedAt: new Date(daysAgo(1).getTime() + 9 * 60_000) },
          ],
        },
        now
      )
    );
    // 25.10.2026: documentation in percent, and the processes that run.
    expect(m.completeness).toMatchObject({ value: 80, display: "80%", state: "ok" });
    expect(m.running).toMatchObject({ value: 67, state: "off" });
    expect(m.noBackup).toBeUndefined();
    expect(m.staleUncertain).toMatchObject({ value: 1, state: "off" });
    expect(m.noAccess).toMatchObject({ value: 1, state: "off" });
    expect(m.coverage).toMatchObject({ value: 67, state: "ok" });
    expect(m.withAnkora).toMatchObject({ value: 50, state: "off" });
    expect(m.batchMinutes).toMatchObject({ value: 6, state: "off" });
    expect(m.oldestProposal).toMatchObject({ value: 4, state: "off" });
    expect(m.onTime).toMatchObject({ value: 50, state: "off" });
  });

  it("adds the clients up for the line on top", () => {
    const r = metricsReport(
      [
        { clientId: "a", clientName: "A", ...empty, systems: [{ accessStatus: "NO_ACCESS" }] },
        { clientId: "b", clientName: "B", ...empty, systems: [{ accessStatus: "PENDING" }, { accessStatus: "HAS_ACCESS" }] },
      ],
      now
    );
    expect(byKey(r.all).noAccess.value).toBe(2);
    expect(r.clients.map((c) => byKey(c.measures).noAccess.value)).toEqual([1, 1]);
  });
});

describe("the weekly email", () => {
  it("leads with what is off, and lists only what is off per client", async () => {
    const { metricsSubject, renderMetricsEmail } = await import("@/lib/brain-metrics-email");
    const r = metricsReport([{ clientId: "a", clientName: "NUX", ...empty, systems: [{ accessStatus: "NO_ACCESS" }] }], now);
    expect(metricsSubject(r, "25.10.2026")).toBe("מדדי התיק, שבוע 25.10.2026: מדד אחד עוד לא ביעד");
    const { html, text } = renderMetricsEmail(r, "אריאל", "https://www.ankora.co.il", "25.10.2026");
    expect(text).toContain("- מערכות בלי גישה: 1 (יעד: יורד). עוד לא.");
    expect(text).toContain("- NUX: מערכות בלי גישה 1");
    expect(text).toContain("https://www.ankora.co.il/app/brain-metrics");
    expect(html).toContain('dir="rtl"');
  });

  it("goes out on Sunday in Israel", async () => {
    const { isMetricsDay } = await import("@/lib/app-domain/brain-metrics");
    expect(isMetricsDay(new Date("2026-10-25T06:00:00Z"))).toBe(true);
    expect(isMetricsDay(new Date("2026-10-24T22:30:00Z"))).toBe(true);
    expect(isMetricsDay(new Date("2026-10-26T06:00:00Z"))).toBe(false);
  });
});
