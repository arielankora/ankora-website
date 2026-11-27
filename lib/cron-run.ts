import "server-only";
import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { describeError, reportIssue, resolveIssue } from "@/lib/system-issues";

/// Every scheduled job runs through here (27.11.2026, silent failures plan).
///
/// Before, a job that failed wrote to the log, and a job that did not run
/// at all left nothing anywhere. Now each run is a cron_runs row (a row
/// with no finishedAt was cut off by the time limit; a day with no row is
/// a job that did not run), and each step of a job is isolated: one step
/// that throws is a system issue and the steps after it still run.
///
/// A step that succeeds closes its open issue, so a failure that cleared
/// on its own does not wait for a person to close it.

/// A failed step's place in the summary, instead of its result. No error
/// text: the summary is the route's public response. The error is in the
/// issue and in the run's row.
export type FailedStep = { failed: true };

export type CronStep = <T>(name: string, work: () => Promise<T>) => Promise<T | FailedStep>;

export function isFailedStep(value: unknown): value is FailedStep {
  return typeof value === "object" && value !== null && (value as { failed?: unknown }).failed === true;
}

export async function runCron(
  job: string,
  request: Request,
  body: (step: CronStep) => Promise<Record<string, unknown>>,
): Promise<NextResponse> {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    // A 500 is the deployment's own fault (no CRON_SECRET): every job answers
    // it every night. A 401 is a stranger at the door, not ours to report.
    if (authorized.status === 500) {
      await reportIssue({ area: "cron", key: "cron-secret-missing", title: `CRON_SECRET חסר: משימת הלילה ${job} לא רצה`, severity: "CRITICAL" });
    }
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  const { response } = await runCronJob(job, body);
  return response;
}

/// The run itself, without the request: for tests and for a job started by hand.
export async function runCronJob(
  job: string,
  body: (step: CronStep) => Promise<Record<string, unknown>>,
): Promise<{ response: NextResponse; failedSteps: string[] }> {
  const run = await prisma.cronRun.create({ data: { job } }).catch((err) => {
    // No record of the run is a loss, not a reason to skip the job.
    console.error(`[cron] ${job}: could not record the run`, err);
    return null;
  });
  const failedSteps: string[] = [];
  const stepErrors: Record<string, string> = {};

  const step: CronStep = async (name, work) => {
    const key = `${job}:${name}`;
    try {
      const result = await work();
      await resolveIssue("cron", key);
      return result;
    } catch (err) {
      failedSteps.push(name);
      stepErrors[name] = describeError(err);
      await reportIssue({
        area: "cron",
        key,
        title: `משימת הלילה ${job}: השלב ${name} נכשל`,
        error: err,
        severity: "CRITICAL",
      });
      return { failed: true };
    }
  };

  try {
    const summary = await body(step);
    const ok = failedSteps.length === 0;
    await finish(run?.id, ok ? { ok, summary } : { ok, summary: { ...summary, failedSteps }, error: JSON.stringify(stepErrors) });
    await resolveIssue("cron", job);
    // 500 when a step failed, so Vercel's own cron view shows the run as failed.
    return { response: NextResponse.json({ ok, ...(ok ? {} : { failedSteps }), ...summary }, { status: ok ? 200 : 500 }), failedSteps };
  } catch (err) {
    // Outside any step: the job as a whole did not run.
    await finish(run?.id, { ok: false, error: describeError(err) });
    await reportIssue({ area: "cron", key: job, title: `משימת הלילה ${job} נכשלה`, error: err, severity: "CRITICAL" });
    return { response: NextResponse.json({ error: "Unexpected error" }, { status: 500 }), failedSteps };
  }
}

async function finish(id: string | undefined, data: { ok: boolean; summary?: Record<string, unknown>; error?: string }) {
  if (!id) return;
  try {
    await prisma.cronRun.update({
      where: { id },
      data: { finishedAt: new Date(), ok: data.ok, summary: data.summary as object | undefined, error: data.error ?? null },
    });
  } catch (err) {
    console.error("[cron] could not record the end of a run", err);
  }
}
