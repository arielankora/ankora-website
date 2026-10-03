import { beforeEach, describe, expect, it, vi } from "vitest";

// The client portal connector (lib/mcp/portal-tools.ts, /api/mcp/portal).
//
// The domain functions are mocked: their client isolation is covered by
// the integration suite (client-portal, portal-phase*). What is under
// test here is what this surface adds on top, and each of these would
// leak or mislead if it went wrong:
//
//   1. Only a CLIENT_USER gets anything. A staff token reaches no domain
//      function at all - not even a read.
//   2. No tool takes a client. The schemas are checked for it, so a
//      later edit cannot add one without failing here.
//   3. Answering a decision is the admin's, resolves by question and
//      label, and writes nothing on a miss.
//   4. Progress counts are computed by the server, not left to the model.

const portal = vi.hoisted(() => ({
  PORTAL_STAGE_LABELS: { RECEIVED: "התקבל", IN_PROGRESS: "בטיפול", WAITING_ON_CLIENT: "מחכה לך", DONE: "הושלם" },
  getCategorySummary: vi.fn(),
  getMonthlyDetailed: vi.fn(),
  getPortalDashboard: vi.fn(),
  getPortalHistory: vi.fn(),
  getPortalHome: vi.fn(),
  getPortalProgress: vi.fn(),
  getPortalTimeline: vi.fn(),
  getWeeklyActivity: vi.fn(),
  resolvePortalClient: vi.fn(),
}));

const decisions = vi.hoisted(() => ({
  getPortalDecisions: vi.fn(),
  respondToDecision: vi.fn(),
  createDecision: vi.fn(),
  listDecisionsForClient: vi.fn(),
}));

const summaries = vi.hoisted(() => ({ getApprovedSummaries: vi.fn() }));
const auth = vi.hoisted(() => ({ actorFromAuthInfo: vi.fn() }));

vi.mock("@/lib/app-domain/client-portal", () => portal);
vi.mock("@/lib/app-domain/decisions", () => decisions);
vi.mock("@/lib/app-domain/portal-summary", () => summaries);
vi.mock("@/lib/mcp/auth", () => auth);
// Reached through task-extra-tools (serializeDecision); never called here.
vi.mock("@/lib/app-domain/tasks", () => ({}));
vi.mock("@/lib/mcp/lookup", () => ({}));

import { registerPortalTools, progressOf, STAFF_ON_PORTAL_MESSAGE } from "@/lib/mcp/portal-tools";
import { PORTAL_TOOL_ANNOTATIONS, PORTAL_WRITE_TOOLS } from "@/lib/mcp/annotations";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { type: string; text: string }[] }>;

function collectTools() {
  const tools = new Map<string, { config: { inputSchema: { shape: Record<string, unknown> }; annotations: unknown }; handler: Handler }>();
  registerPortalTools({
    registerTool: (name: string, config: never, handler: Handler) => {
      tools.set(name, { config, handler });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return tools;
}

const OREN = { id: "u-oren", name: "Oren", role: "CLIENT_USER", timezone: "Asia/Jerusalem" };
const ARIEL = { id: "u-ariel", name: "Ariel", role: "SUPER_ADMIN", timezone: "Asia/Jerusalem" };
const CTX = { http: { authInfo: { token: "verified" } } };

function payload(result: { content: { type: string; text: string }[] }) {
  const text = result.content.map((c) => c.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

let tools: ReturnType<typeof collectTools>;
const call = async (name: string, args: unknown = {}) => payload(await tools.get(name)!.handler(args, CTX));

const promise = (title: string, stage: string, extra: Record<string, unknown> = {}) => ({
  id: `p-${title}`,
  title,
  stage,
  waitingSince: null,
  dueDate: null,
  movedAt: new Date("2026-10-05T08:00:00Z"),
  outcome: null,
  ...extra,
});

const OPEN_DECISION = {
  id: "d1",
  question: "מה סף האישור לרכישת תוכנה?",
  background: null,
  amountMinor: null,
  ceilingMinor: null,
  aboveCeiling: false,
  dueAt: null,
  status: "OPEN",
  createdAt: new Date("2026-10-04T08:00:00Z"),
  taskTitle: null,
  answer: null,
  options: [
    { id: "o1", label: "3,000 דולר בשנה", detail: null, amountMinor: null, recommended: true },
    { id: "o2", label: "5,000 דולר בשנה", detail: null, amountMinor: null, recommended: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.actorFromAuthInfo.mockReturnValue(OREN);
  portal.resolvePortalClient.mockResolvedValue({ clientUserRole: "ADMIN" });
  decisions.getPortalDecisions.mockResolvedValue({ open: [OPEN_DECISION], closed: [] });
  tools = collectTools();
});

describe("the surface", () => {
  it("registers exactly the tools the annotations table declares, with those annotations", () => {
    expect([...tools.keys()].sort()).toEqual(Object.keys(PORTAL_TOOL_ANNOTATIONS).sort());
    for (const [name, t] of tools) {
      expect(t.config.annotations, name).toEqual(PORTAL_TOOL_ANNOTATIONS[name as keyof typeof PORTAL_TOOL_ANNOTATIONS]);
    }
  });

  it("has one write, answering a decision", () => {
    expect([...PORTAL_WRITE_TOOLS]).toEqual(["answer_decision"]);
    const writes = Object.entries(PORTAL_TOOL_ANNOTATIONS).filter(([, a]) => !a.readOnlyHint).map(([n]) => n);
    expect(writes).toEqual(["answer_decision"]);
  });

  it("never takes a client, a user or an id as an argument", () => {
    for (const [name, t] of tools) {
      const keys = Object.keys(t.config.inputSchema.shape);
      for (const forbidden of ["client", "clientId", "user", "userId", "id"]) {
        expect(keys, `${name} takes ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("only a client portal user gets an answer", () => {
  it("refuses staff on every tool and reaches no domain function", async () => {
    auth.actorFromAuthInfo.mockReturnValue(ARIEL);
    for (const name of tools.keys()) {
      const out = await call(name, name === "answer_decision" ? { decision: "x", option: "y" } : {});
      expect(out.text, name).toBe(STAFF_ON_PORTAL_MESSAGE);
    }
    for (const fn of [
      portal.getPortalHome,
      portal.getPortalTimeline,
      portal.getWeeklyActivity,
      portal.getMonthlyDetailed,
      portal.getPortalDashboard,
      portal.resolvePortalClient,
      decisions.getPortalDecisions,
      decisions.respondToDecision,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("get_status", () => {
  it("counts progress on the server and passes the signed-in user, nothing else", async () => {
    portal.getPortalHome.mockResolvedValue({
      client: { name: "NUX" },
      openDecisions: 2,
      contact: { managerName: "Ariel", whatsappNumber: null },
      waitingOnClient: [promise("ספי אישור", "WAITING_ON_CLIENT", { waitingSince: new Date("2026-10-04T08:00:00Z") })],
      inProgress: [promise("Payroll", "IN_PROGRESS")],
      recentlyDone: [promise("Slack", "DONE", { outcome: "אנקורה צורפה ל-Slack" })],
      cycle: { usedMinutes: 600, totalMinutes: 2400, pct: 25, daysLeft: 20 },
    });
    // The counts come from their own uncapped query, not from any list.
    portal.getPortalProgress.mockResolvedValue({ total: 5, DONE: 2, IN_PROGRESS: 1, WAITING_ON_CLIENT: 1, RECEIVED: 1 });

    const out = await call("get_status");

    expect(portal.getPortalTimeline).not.toHaveBeenCalled();

    expect(portal.getPortalHome).toHaveBeenCalledWith(OREN);
    expect(out.progress).toEqual({ total: 5, done: 2, inProgress: 1, notStarted: 1, waitingForYou: 1, percentDone: 40 });
    expect(out.decisionsWaitingForYou).toBe(2);
    expect(out.waitingForYou[0]).toMatchObject({ title: "ספי אישור", stageLabel: "מחכה לך", waitingForYouSince: "2026-10-04" });
    expect(out.recentlyDone[0].outcome).toBe("אנקורה צורפה ל-Slack");
    expect(out.hourBank).toEqual({ usedHours: 10, totalHours: 40, percentUsed: 25, daysLeftInCycle: 20 });
  });

  it("reports 0% rather than NaN for a client with nothing visible yet", () => {
    expect(progressOf({ total: 0, DONE: 0, IN_PROGRESS: 0, WAITING_ON_CLIENT: 0, RECEIVED: 0 }).percentDone).toBe(0);
  });
});

describe("list_tasks", () => {
  it("filters by stage and search, and still counts the whole list", async () => {
    portal.getPortalTimeline.mockResolvedValue({
      client: { name: "NUX" },
      promises: [promise("Payroll ישראל", "IN_PROGRESS"), promise("Payroll ארה״ב", "DONE"), promise("Slack", "DONE")],
    });
    portal.getPortalProgress.mockResolvedValue({ total: 3, DONE: 2, IN_PROGRESS: 1, WAITING_ON_CLIENT: 0, RECEIVED: 0 });
    const out = await call("list_tasks", { stage: "DONE", search: "payroll" });
    expect(out.tasks.map((t: { title: string }) => t.title)).toEqual(["Payroll ארה״ב"]);
    expect(out.progress.total).toBe(3);
    expect(out.listTruncated).toBe(false);
  });

  it("says when the list is shorter than the whole, and keeps the true total", async () => {
    // The bug this guards: 55 visible tasks against a 60-row stream on
    // the first day of the NUX handover. Progress must count all of
    // them, and a capped list must say it is capped.
    portal.getPortalTimeline.mockResolvedValue({
      client: { name: "NUX" },
      promises: Array.from({ length: 200 }, (_, i) => promise(`t${i}`, "RECEIVED")),
    });
    portal.getPortalProgress.mockResolvedValue({ total: 230, DONE: 30, IN_PROGRESS: 0, WAITING_ON_CLIENT: 0, RECEIVED: 200 });
    const out = await call("list_tasks");
    expect(out.progress.total).toBe(230);
    expect(out.progress.percentDone).toBe(13);
    expect(out.listTruncated).toBe(true);
  });
});

describe("answer_decision", () => {
  it("resolves the decision by its question and the option by its label", async () => {
    const out = await call("answer_decision", { decision: "סף האישור", option: "3,000" });
    expect(decisions.respondToDecision).toHaveBeenCalledWith(OREN, "d1", "o1");
    expect(out.answered).toBe(true);
    expect(out.chose).toBe("3,000 דולר בשנה");
  });

  it("refuses a viewer in words, and writes nothing", async () => {
    portal.resolvePortalClient.mockResolvedValue({ clientUserRole: "VIEWER" });
    const out = await call("answer_decision", { decision: "סף האישור", option: "3,000" });
    expect(decisions.respondToDecision).not.toHaveBeenCalled();
    expect(out.text).toContain("admin");
  });

  it("writes nothing when the option is ambiguous", async () => {
    const out = await call("answer_decision", { decision: "סף האישור", option: "דולר" });
    expect(decisions.respondToDecision).not.toHaveBeenCalled();
    expect(out.text).toContain("more than one");
  });

  it("writes nothing when no open decision matches", async () => {
    await call("answer_decision", { decision: "ביטוח", option: "3,000" });
    expect(decisions.respondToDecision).not.toHaveBeenCalled();
  });
});

describe("reports", () => {
  it("weekly_report reads the week containing the given day, in hours", async () => {
    portal.getWeeklyActivity.mockResolvedValue({
      from: new Date("2026-10-03T21:00:00Z"),
      to: new Date("2026-10-10T21:00:00Z"),
      rows: [{ date: "2026-10-05", activity: "Payroll", category: "שכר", billableMinutes: 90 }],
      totalMinutes: 90,
      byCategory: [{ category: "שכר", minutes: 90 }],
      dailyTotals: [{ date: "2026-10-05", minutes: 90 }],
      topActivities: [{ activity: "Payroll", minutes: 90 }],
    });
    const out = await call("weekly_report", { weekOf: "2026-10-07" });
    const anchor: Date = portal.getWeeklyActivity.mock.calls[0][1];
    expect(anchor.toISOString()).toBe("2026-10-07T09:00:00.000Z");
    expect(out.totalHours).toBe(1.5);
    expect(out.from).toBe("2026-10-04");
  });

  it("monthly_report attaches the approved summary of that month only", async () => {
    const from = new Date("2026-09-30T21:00:00Z");
    portal.getMonthlyDetailed.mockResolvedValue({
      from,
      to: new Date("2026-10-31T22:00:00Z"),
      rows: [],
      totalMinutes: 3000,
      tasksCompleted: 7,
    });
    portal.getCategorySummary.mockResolvedValue({ rows: [{ category: "שכר", minutes: 1500, pctOfTotal: 50 }] });
    summaries.getApprovedSummaries.mockResolvedValue([
      { periodStart: new Date("2026-08-31T21:00:00Z"), draft: "ספטמבר", approvedAt: new Date("2026-10-01T08:00:00Z") },
      { periodStart: from, draft: "אוקטובר", approvedAt: new Date("2026-11-01T08:00:00Z") },
    ]);

    const out = await call("monthly_report", { month: "2026-10" });

    expect(portal.getCategorySummary).toHaveBeenCalledWith(OREN, from, expect.any(Date));
    expect(out.month).toBe("2026-10");
    expect(out.totalHours).toBe(50);
    expect(out.summary.text).toBe("אוקטובר");
    expect(out.byCategory).toEqual([{ category: "שכר", hours: 25, percent: 50 }]);
  });

  it("monthly_report says there is no summary rather than showing another month's", async () => {
    portal.getMonthlyDetailed.mockResolvedValue({ from: new Date("2026-09-30T21:00:00Z"), to: new Date(), rows: [], totalMinutes: 0, tasksCompleted: 0 });
    portal.getCategorySummary.mockResolvedValue({ rows: [] });
    summaries.getApprovedSummaries.mockResolvedValue([
      { periodStart: new Date("2026-08-31T21:00:00Z"), draft: "ספטמבר", approvedAt: new Date() },
    ]);
    const out = await call("monthly_report", { month: "2026-10" });
    expect(out.summary).toBeNull();
  });
});

describe("what is needed from the client", () => {
  it("passes the request and the number of open decisions through to the model", async () => {
    portal.getPortalTimeline.mockResolvedValue({
      client: { name: "NUX" },
      promises: [promise("ספי אישור", "WAITING_ON_CLIENT", { waitingFor: "לבחור 2 ספי אישור", openDecisions: 2 })],
    });
    const out = await call("list_tasks");
    expect(out.tasks[0]).toMatchObject({ whatIsNeededFromYou: "לבחור 2 ספי אישור", decisionsToAnswer: 2 });
  });
});
