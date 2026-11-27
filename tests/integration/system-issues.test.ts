import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// System issues (27.11.2026, silent failures plan, stage 1): a failure is
// written down once per (area, key), counted when it happens again, emails
// the admins when it is CRITICAL at most once in 20 hours, and only an
// email that went out counts. Nightly jobs run through lib/cron-run.ts,
// which records each run and isolates each step.

vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return { ...real, sendEmail: vi.fn() };
});
import { sendEmail } from "@/lib/email";
import { ALERT_EVERY_MS, reportIssue, resolveIssue } from "@/lib/system-issues";
import { alertAdmins } from "@/lib/comms/admin-alert";
import { runCronJob } from "@/lib/cron-run";

const T0 = new Date("2026-11-27T00:30:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 60 * 60 * 1000;

const issue = (severity: "CRITICAL" | "WARNING" = "CRITICAL", now = T0) =>
  reportIssue({ area: "comms", key: "step:transcribe", title: "התמלול נכשל", error: new Error("audio not found"), severity, now });

beforeEach(async () => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "m" });
  await createTestUser({ role: "SUPER_ADMIN", email: "boss@ankora.test" });
  await createTestUser({ role: "ANKORA_EMPLOYEE", email: "worker@ankora.test" });
});

describe("reportIssue", () => {
  it("writes one row per area and key, and counts it when it happens again", async () => {
    await issue();
    await issue("CRITICAL", later(HOUR));
    const rows = await prisma.systemIssue.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ area: "comms", key: "step:transcribe", count: 2, status: "OPEN", detail: "Error: audio not found" });
  });

  it("emails the admins about a CRITICAL issue once, and again only after 20 hours", async () => {
    await issue();
    await issue("CRITICAL", later(HOUR));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [email] = vi.mocked(sendEmail).mock.calls[0];
    expect(email.to).toEqual(["boss@ankora.test"]);
    expect(email.reportFailure).toBe(false);

    await issue("CRITICAL", later(ALERT_EVERY_MS));
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("does not email about a WARNING", async () => {
    await issue("WARNING");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.systemIssue.count()).toBe(1);
  });

  it("tries the email again next time when it did not go out", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "Resend API error 500: down" });
    await issue();
    expect((await prisma.systemIssue.findFirstOrThrow()).lastAlertedAt).toBeNull();
    await issue("CRITICAL", later(HOUR));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect((await prisma.systemIssue.findFirstOrThrow()).lastAlertedAt).not.toBeNull();
  });

  it("opens a resolved issue again when it happens again, and alerts at once", async () => {
    await issue();
    await resolveIssue("comms", "step:transcribe");
    expect((await prisma.systemIssue.findFirstOrThrow()).status).toBe("RESOLVED");
    await issue("CRITICAL", later(HOUR));
    expect((await prisma.systemIssue.findFirstOrThrow()).status).toBe("OPEN");
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("never throws, even when it cannot write", async () => {
    await expect(reportIssue({ area: "x".repeat(10), key: "k", title: "t", severity: "WARNING", now: new Date("invalid") })).resolves.toBeUndefined();
  });
});

describe("sendEmail reports its own failure", () => {
  it("a failed email is an email issue, keyed by kind, never by message", async () => {
    const real = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 503 }));
    const key = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test";
    try {
      const result = await real.sendEmail({ to: ["a@b.test"], subject: "דוח חודשי", text: "גוף ההודעה" });
      expect(result.ok).toBe(false);
    } finally {
      process.env.RESEND_API_KEY = key;
      fetchSpy.mockRestore();
    }
    const row = await prisma.systemIssue.findFirstOrThrow();
    expect(row).toMatchObject({ area: "email", key: "provider-503", severity: "CRITICAL" });
    expect(row.detail).toContain("דוח חודשי");
    expect(row.detail).not.toContain("גוף ההודעה");
  });
});

describe("alertAdmins counts only an alert whose email went out", () => {
  const alert = (now: Date) =>
    alertAdmins({ type: "test.alert", subjectId: "s1", entityType: "Test", render: () => ({ title: "t", body: "b" }), now });

  it("sends again on the next run when the email failed", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "down" });
    await alert(T0);
    await alert(later(HOUR));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    await alert(later(2 * HOUR));
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  // Was: a 24 hour window, so a nightly job that alerted at 00:30:05 was
  // skipped at 00:30:03 the next night, and every second night went silent.
  it("alerts again the next night even a few seconds earlier", async () => {
    await alert(T0);
    await alert(new Date(T0.getTime() + 24 * HOUR - 2000));
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe("runCronJob", () => {
  it("records the run, isolates a failing step, and reports it", async () => {
    const { response, failedSteps } = await runCronJob("test-job", async (step) => {
      const a = await step("first", async () => {
        throw new Error("mailbox 401");
      });
      const b = await step("second", async () => ({ done: 3 }));
      return { a, b };
    });
    expect(failedSteps).toEqual(["first"]);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, failedSteps: ["first"], a: { failed: true }, b: { done: 3 } });
    expect(JSON.stringify(body)).not.toContain("mailbox 401");

    const run = await prisma.cronRun.findFirstOrThrow({ where: { job: "test-job" } });
    expect(run.ok).toBe(false);
    expect(run.finishedAt).not.toBeNull();
    expect(run.error).toContain("mailbox 401");
    const row = await prisma.systemIssue.findFirstOrThrow({ where: { area: "cron" } });
    expect(row).toMatchObject({ key: "test-job:first", status: "OPEN", severity: "CRITICAL" });
  });

  it("closes a step's issue when the step works again", async () => {
    await runCronJob("test-job", async (step) => ({
      a: await step("first", async () => {
        throw new Error("x");
      }),
    }));
    const { response } = await runCronJob("test-job", async (step) => ({ a: await step("first", async () => 1) }));
    expect(response.status).toBe(200);
    expect((await prisma.systemIssue.findFirstOrThrow({ where: { key: "test-job:first" } })).status).toBe("RESOLVED");
    expect(await prisma.cronRun.count({ where: { job: "test-job" } })).toBe(2);
  });
});
