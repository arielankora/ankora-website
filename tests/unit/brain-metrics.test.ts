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
            { status: "ACTIVE", transitionStatus: "WITH_ANKORA", backupOwnerId: "b", completeness: 9 },
            { status: "ACTIVE", transitionStatus: "IN_HANDOVER", backupOwnerId: null, completeness: 6 },
            { status: "ACTIVE", transitionStatus: "NOT_PLANNED", backupOwnerId: "b", completeness: 9 },
            { status: "RETIRED", transitionStatus: "WITH_ANKORA", backupOwnerId: null, completeness: 1 },
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
    expect(m.completeness).toMatchObject({ value: 8, state: "ok" });
    expect(m.noBackup).toMatchObject({ value: 1, state: "off" });
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
