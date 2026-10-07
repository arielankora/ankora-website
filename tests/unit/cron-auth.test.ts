import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two Vercel Cron routes are public URLs. Whoever can call them can
// trigger the nightly export (a full Excel dump of every client, emailed
// out), client alerts, reminders and the morning digest. The only thing
// standing between the internet and those jobs is the CRON_SECRET bearer
// check in lib/cron-auth.ts, so it is tested on its own and then again
// at each route, to prove the route asks BEFORE it starts any work.

// Every job the two routes run, mocked, so a call that slips past the
// gate is visible as a call rather than as real side effects.
const jobs = vi.hoisted(() => ({
  reconcileAllClientAlerts: vi.fn(),
  retryFailedEmailDeliveries: vi.fn(),
  notifyLongRunningTimers: vi.fn(),
  reconcileImportantDates: vi.fn(),
  sendDailyTaskDigest: vi.fn(),
  reconcileScheduledReports: vi.fn(),
  sendNightlyDataExport: vi.fn(),
}));

vi.mock("@/lib/app-domain/alerts", () => ({
  reconcileAllClientAlerts: jobs.reconcileAllClientAlerts,
  retryFailedEmailDeliveries: jobs.retryFailedEmailDeliveries,
}));
vi.mock("@/lib/app-domain/notifications", () => ({ notifyLongRunningTimers: jobs.notifyLongRunningTimers }));
vi.mock("@/lib/app-domain/important-dates-job", () => ({ reconcileImportantDates: jobs.reconcileImportantDates }));
vi.mock("@/lib/app-domain/task-digest", () => ({ sendDailyTaskDigest: jobs.sendDailyTaskDigest }));
vi.mock("@/lib/app-domain/report-schedules", () => ({ reconcileScheduledReports: jobs.reconcileScheduledReports }));
vi.mock("@/lib/app-domain/backup-export", () => ({ sendNightlyDataExport: jobs.sendNightlyDataExport }));

const { authorizeCronRequest } = await import("@/lib/cron-auth");
const alertsRoute = await import("@/app/api/cron/alerts-reconcile/route");
const reportsRoute = await import("@/app/api/cron/scheduled-reports/route");

const SECRET = "s3cr3t-cron-value-0123456789";
const ORIGINAL = process.env.CRON_SECRET;

function req(path: string, authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request(`https://www.ankora.co.il${path}`, { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  for (const fn of Object.values(jobs)) fn.mockReset();
  jobs.reconcileAllClientAlerts.mockResolvedValue(0);
  jobs.retryFailedEmailDeliveries.mockResolvedValue(0);
  jobs.notifyLongRunningTimers.mockResolvedValue({ notified: 0 });
  jobs.reconcileImportantDates.mockResolvedValue({});
  jobs.sendDailyTaskDigest.mockResolvedValue({});
  jobs.reconcileScheduledReports.mockResolvedValue({ sent: 0 });
  jobs.sendNightlyDataExport.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
  vi.restoreAllMocks();
});

describe("authorizeCronRequest() - the CRON_SECRET bearer check", () => {
  it("accepts exactly `Bearer <CRON_SECRET>`", () => {
    expect(authorizeCronRequest(req("/x", `Bearer ${SECRET}`))).toEqual({ ok: true });
  });

  it("fails closed with 500 when CRON_SECRET is not configured, even for an empty bearer", () => {
    // Without a secret, `Bearer ${undefined}` would be a guessable string;
    // an unconfigured deployment must refuse everyone, not accept a guess.
    delete process.env.CRON_SECRET;
    expect(authorizeCronRequest(req("/x", "Bearer undefined"))).toMatchObject({ ok: false, status: 500 });
    expect(authorizeCronRequest(req("/x", "Bearer "))).toMatchObject({ ok: false, status: 500 });
    process.env.CRON_SECRET = "";
    expect(authorizeCronRequest(req("/x", "Bearer "))).toMatchObject({ ok: false, status: 500 });
  });

  it.each([
    ["no header at all", undefined],
    ["an empty header", ""],
    ["the secret without the Bearer scheme", SECRET],
    ["a wrong secret", "Bearer not-the-secret"],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret with extra characters", `Bearer ${SECRET}x`],
    ["a different-case scheme", `bearer ${SECRET}`],
    ["a different-case secret", `Bearer ${SECRET.toUpperCase()}`],
    ["the bare scheme", "Bearer"],
  ])("refuses %s with 401", (_label, header) => {
    expect(authorizeCronRequest(req("/x", header))).toEqual({ ok: false, status: 401, error: "Unauthorized" });
  });
});

describe.each([
  ["alerts-reconcile", "/api/cron/alerts-reconcile", () => alertsRoute.GET],
  ["scheduled-reports", "/api/cron/scheduled-reports", () => reportsRoute.GET],
] as const)("GET /api/cron/%s - gate runs before any job", (_name, path, handler) => {
  it("answers 401 to an unauthenticated call and runs no job", async () => {
    const res = await handler()(req(path));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled();
  });

  it("answers 401 to a wrong secret and runs no job", async () => {
    const res = await handler()(req(path, "Bearer guess"));
    expect(res.status).toBe(401);
    for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled();
  });

  it("answers 500 and runs no job when the deployment has no CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const res = await handler()(req(path, "Bearer undefined"));
    expect(res.status).toBe(500);
    for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled();
  });

  it("runs its jobs for Vercel's own call", async () => {
    const res = await handler()(req(path, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("which jobs each authorised cron runs (vercel.json schedules them)", () => {
  it("alerts-reconcile runs alerts, retries, long timers, important dates and the digest, not the export", async () => {
    await alertsRoute.GET(req("/api/cron/alerts-reconcile", `Bearer ${SECRET}`));
    expect(jobs.reconcileAllClientAlerts).toHaveBeenCalledOnce();
    expect(jobs.retryFailedEmailDeliveries).toHaveBeenCalledOnce();
    expect(jobs.notifyLongRunningTimers).toHaveBeenCalledOnce();
    expect(jobs.reconcileImportantDates).toHaveBeenCalledOnce();
    expect(jobs.sendDailyTaskDigest).toHaveBeenCalledOnce();
    expect(jobs.sendNightlyDataExport).not.toHaveBeenCalled();
  });

  it("scheduled-reports runs report schedules and the nightly export", async () => {
    await reportsRoute.GET(req("/api/cron/scheduled-reports", `Bearer ${SECRET}`));
    expect(jobs.reconcileScheduledReports).toHaveBeenCalledOnce();
    expect(jobs.sendNightlyDataExport).toHaveBeenCalledOnce();
  });

  it("answers 500 without leaking the error when a job throws", async () => {
    jobs.sendNightlyDataExport.mockRejectedValue(new Error("db password=hunter2"));
    const res = await reportsRoute.GET(req("/api/cron/scheduled-reports", `Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });
});
