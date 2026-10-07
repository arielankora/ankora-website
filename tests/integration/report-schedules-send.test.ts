import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry, createTestClientUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { archiveClient } from "@/lib/app-domain/clients";
import { retryFailedEmailDeliveries } from "@/lib/app-domain/alerts";
import {
  listReportSchedulesForClient,
  createReportSchedule,
  updateReportSchedule,
  deleteReportSchedule,
  sendReportSchedule,
  reconcileScheduledReports,
  sendReportScheduleNow,
  computeReportingPeriod,
} from "@/lib/app-domain/report-schedules";

// Scheduled client reports (spec 15), end to end against a real database:
// the cron path (reconcileScheduledReports -> sendReportSchedule ->
// buildSnapshot/renderEmailBody), the admin "send now" test path, and the
// schedule CRUD the admin screen drives. The pure pieces (isScheduleDue,
// computeReportingPeriod, monthlyDetailedToCsv) are already covered in
// tests/unit/report-schedules*.test.ts and are not repeated here.
//
// What matters most in this file is the thing a client would notice: an
// email that went to the wrong people, carried another client's hours, or
// arrived twice. sendEmail is mocked so every assertion can look at
// exactly who got what.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}));
import { sendEmail } from "@/lib/email";

// The cron fires at 00:00 UTC (vercel.json). On Sunday 2026-10-04 that is
// 03:00 in Israel, also Sunday, so a WEEKLY dayOfWeek=0 schedule is due.
// The week being reported on is the ISRAELI week Sun 27.9 - Sat 3.10
// (Ariel, 2026-09-20), i.e. [2026-09-26T21:00Z, 2026-10-03T21:00Z) in IDT.
const CRON_NOW = new Date("2026-10-04T00:00:00Z");
const ISRAELI_WEEK_FROM = "2026-09-26T21:00:00.000Z";
const ISRAELI_WEEK_TO = "2026-10-03T21:00:00.000Z";

function sentEmails() {
  return vi.mocked(sendEmail).mock.calls.map(([input]) => input);
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "msg-1" });
});

/// Two clients with hours in the same reporting week, each with a
/// category name that only ever belongs to them, so a leak of one
/// client's rows into the other's email is visible as a string.
async function twoClientsWithHours() {
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const clientA = await createTestClient({ name: "Client Alpha" });
  const clientB = await createTestClient({ name: "Client Beta" });
  const catA = await createTestCategory({ clientId: clientA.id, name: "alpha-legal-work" });
  const catB = await createTestCategory({ clientId: clientB.id, name: "beta-secret-project" });

  // 2026-09-26T21:30Z is 00:30 on Sunday 27.9 in Israel: inside the
  // Israeli week, even though its UTC date is still the 26th.
  await createTestTimeEntry({
    userId: employee.id,
    clientId: clientA.id,
    categoryId: catA.id,
    startAt: new Date("2026-09-26T21:30:00Z"),
    endAt: new Date("2026-09-26T22:30:00Z"),
  });
  // 2026-10-03T21:30Z is 00:30 on Sunday 4.10 in Israel: the NEXT week,
  // even though its UTC date is still Saturday the 3rd.
  const catAOutside = await createTestCategory({ clientId: clientA.id, name: "alpha-next-week" });
  await createTestTimeEntry({
    userId: employee.id,
    clientId: clientA.id,
    categoryId: catAOutside.id,
    startAt: new Date("2026-10-03T21:30:00Z"),
    endAt: new Date("2026-10-03T22:00:00Z"),
  });
  await createTestTimeEntry({
    userId: employee.id,
    clientId: clientB.id,
    categoryId: catB.id,
    startAt: new Date("2026-09-30T08:00:00Z"),
    endAt: new Date("2026-09-30T10:00:00Z"),
  });

  const scheduleA = await createReportSchedule(admin, clientA.id, {
    reportType: "HOURS_BY_CATEGORY",
    frequency: "WEEKLY",
    dayOfWeek: 0,
    recipients: ["ceo@alpha.example"],
  });
  const scheduleB = await createReportSchedule(admin, clientB.id, {
    reportType: "HOURS_BY_CATEGORY",
    frequency: "WEEKLY",
    dayOfWeek: 0,
    recipients: ["cfo@beta.example"],
  });

  return { admin, employee, clientA, clientB, scheduleA, scheduleB };
}

describe("reconcileScheduledReports() - each client's email carries only that client's data, to only its recipients", () => {
  it("sends client A's hours only to A's recipients and client B's only to B's", async () => {
    await twoClientsWithHours();

    const result = await reconcileScheduledReports(CRON_NOW);
    expect(result).toEqual({ checked: 2, sent: 2, skipped: 0 });

    const emails = sentEmails();
    expect(emails).toHaveLength(2);
    const toAlpha = emails.find((e) => e.to.includes("ceo@alpha.example"))!;
    const toBeta = emails.find((e) => e.to.includes("cfo@beta.example"))!;

    // Exactly the schedule's own recipients, nobody else's.
    expect(toAlpha.to).toEqual(["ceo@alpha.example"]);
    expect(toBeta.to).toEqual(["cfo@beta.example"]);

    // The isolation property: neither email mentions the other client.
    expect(toAlpha.text).toContain("alpha-legal-work: 60 דקות");
    expect(toAlpha.text).not.toContain("beta-secret-project");
    expect(toAlpha.subject).not.toContain("Client Beta");
    expect(toBeta.text).toContain("beta-secret-project: 120 דקות");
    expect(toBeta.text).not.toContain("alpha");
    expect(toBeta.subject).not.toContain("Client Alpha");
  });

  it("reports on the Israeli Sun-Sat week: 00:30 Sunday Israel time is in, 00:30 the following Sunday is out", async () => {
    const { scheduleA } = await twoClientsWithHours();

    await reconcileScheduledReports(CRON_NOW);

    const toAlpha = sentEmails().find((e) => e.to.includes("ceo@alpha.example"))!;
    expect(toAlpha.text).toContain("alpha-legal-work");
    expect(toAlpha.text).not.toContain("alpha-next-week");
    // The period label a client reads is the Israeli week, inclusive.
    expect(toAlpha.subject).toContain("2026-09-27 - 2026-10-03");

    const run = await prisma.reportRun.findFirstOrThrow({ where: { scheduleId: scheduleA.id } });
    expect(run.periodStart.toISOString()).toBe(ISRAELI_WEEK_FROM);
    expect(run.periodEnd.toISOString()).toBe(ISRAELI_WEEK_TO);
  });

  it("is idempotent: a second cron run for the same period sends nothing, even with lastSentAt cleared", async () => {
    const { scheduleA, scheduleB } = await twoClientsWithHours();

    await reconcileScheduledReports(CRON_NOW);
    expect(sendEmail).toHaveBeenCalledTimes(2);

    // Second run, same moment: the cheap lastSentAt guard stops it.
    const again = await reconcileScheduledReports(CRON_NOW);
    expect(again.sent).toBe(0);

    // Now take the cheap guard away (an overlapping run that read the
    // schedule before the first run wrote lastSentAt). The ReportRun
    // unique (scheduleId, periodStart) is the real guarantee and must
    // still hold: nobody gets the same week twice.
    await prisma.reportSchedule.updateMany({ data: { lastSentAt: null } });
    const third = await reconcileScheduledReports(new Date(CRON_NOW.getTime() + 3600_000));
    expect(third.sent).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(2);

    expect(await prisma.reportRun.count({ where: { scheduleId: scheduleA.id } })).toBe(1);
    expect(await prisma.reportRun.count({ where: { scheduleId: scheduleB.id } })).toBe(1);
  });

  it("sends again for the next period a week later", async () => {
    const { scheduleA } = await twoClientsWithHours();
    await reconcileScheduledReports(CRON_NOW);

    // lastSentAt is stamped with the real clock, so it is cleared here to
    // keep this test independent of when the suite happens to run.
    await prisma.reportSchedule.updateMany({ data: { lastSentAt: null } });
    vi.mocked(sendEmail).mockClear();
    await reconcileScheduledReports(new Date("2026-10-11T00:00:00Z"));

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const runs = await prisma.reportRun.findMany({ where: { scheduleId: scheduleA.id }, orderBy: { periodStart: "asc" } });
    expect(runs.map((r) => r.periodStart.toISOString())).toEqual([ISRAELI_WEEK_FROM, ISRAELI_WEEK_TO]);
  });

  it("does not send on a day that is not the schedule's day", async () => {
    await twoClientsWithHours();
    // Monday 5.10 in Israel.
    const result = await reconcileScheduledReports(new Date("2026-10-05T00:00:00Z"));
    expect(result.sent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send a disabled schedule, a deleted schedule, or a schedule of an archived client", async () => {
    const { admin, clientA, clientB, scheduleA, scheduleB } = await twoClientsWithHours();
    const clientC = await createTestClient({ name: "Client Gamma" });
    const scheduleC = await createReportSchedule(admin, clientC.id, {
      reportType: "HOURS_BY_CATEGORY",
      frequency: "WEEKLY",
      dayOfWeek: 0,
      recipients: ["owner@gamma.example"],
    });
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });

    await updateReportSchedule(admin, scheduleA.id, { enabled: false });
    await deleteReportSchedule(admin, scheduleB.id);
    await archiveClient(superAdmin, clientC.id);

    const result = await reconcileScheduledReports(CRON_NOW);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(await prisma.reportRun.count()).toBe(0);
    // The archived client's schedule is still there (archive is a soft
    // delete), it just must not mail anyone.
    expect(await prisma.reportSchedule.findUnique({ where: { id: scheduleC.id } })).not.toBeNull();
    void clientA;
    void clientB;
  });

  it("hides employee names from the email when the client's portal hides them", async () => {
    const { admin, employee, clientA } = await twoClientsWithHours();
    await prisma.client.update({ where: { id: clientA.id }, data: { portalShowEmployeeNames: false } });
    await prisma.reportSchedule.deleteMany();
    await createReportSchedule(admin, clientA.id, {
      reportType: "WEEKLY_ACTIVITY",
      frequency: "WEEKLY",
      dayOfWeek: 0,
      recipients: ["ceo@alpha.example"],
    });

    await reconcileScheduledReports(CRON_NOW);

    const [email] = sentEmails();
    expect(email.text).toContain("alpha-legal-work");
    expect(email.text).not.toContain(employee.name);
  });

  it("includes this client's APPROVED summary for the period, never a draft and never another client's", async () => {
    const { admin, clientA, clientB } = await twoClientsWithHours();
    const periodStart = new Date(ISRAELI_WEEK_FROM);
    const periodEnd = new Date(ISRAELI_WEEK_TO);
    await prisma.portalSummary.create({
      data: { clientId: clientA.id, periodStart, periodEnd, draft: "Alpha: the lease renewal is done.", status: "APPROVED", approvedById: admin.id, approvedAt: new Date() },
    });
    await prisma.portalSummary.create({
      data: { clientId: clientB.id, periodStart, periodEnd, draft: "Beta: unsigned draft about the acquisition.", status: "DRAFT" },
    });

    await reconcileScheduledReports(CRON_NOW);

    const toAlpha = sentEmails().find((e) => e.to.includes("ceo@alpha.example"))!;
    const toBeta = sentEmails().find((e) => e.to.includes("cfo@beta.example"))!;
    expect(toAlpha.text).toContain("Alpha: the lease renewal is done.");
    expect(toAlpha.text).not.toContain("acquisition");
    // A summary nobody approved does not travel.
    expect(toBeta.text).not.toContain("acquisition");
    expect(toBeta.text).not.toContain("lease renewal");
  });
});

describe("sendReportSchedule() - failures are recorded, and an empty recipient list sends nothing", () => {
  it("records a FAILED delivery tied to the run and leaves lastSentAt unset when the provider fails", async () => {
    const { scheduleA } = await twoClientsWithHours();
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "Resend 500" });

    const period = computeReportingPeriod("WEEKLY", CRON_NOW);
    const result = await sendReportSchedule(scheduleA, period, true);

    expect(result).toEqual({ sent: false, reason: "Resend 500" });
    const delivery = await prisma.emailDelivery.findFirstOrThrow();
    expect(delivery.status).toBe("FAILED");
    expect(delivery.recipients).toEqual(["ceo@alpha.example"]);
    expect(delivery.error).toBe("Resend 500");
    expect(delivery.template).toBe("report.hours_by_category");
    const run = await prisma.reportRun.findFirstOrThrow();
    expect(delivery.reportRunId).toBe(run.id);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleA.id } })).lastSentAt).toBeNull();
  });

  // Found 7.10.2026: a scheduled report whose send failed was never really
  // re-delivered. The ReportRun is created even on failure (so the cron
  // treats the period as done), and the only retry, the alerts cron's
  // retryFailedEmailDeliveries(), mailed a fixed "hour bank alert" stub to
  // the client instead of the report. The delivery now stores what it sent,
  // and the retry resends exactly that.
  it("a failed scheduled report is eventually delivered with its real content", async () => {
    const { scheduleA } = await twoClientsWithHours();
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "Resend 500" });
    await sendReportSchedule(scheduleA, computeReportingPeriod("WEEKLY", CRON_NOW), true);

    vi.mocked(sendEmail).mockClear();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "retry" });
    // The next daily runs: the alerts cron's retry, then the reports cron.
    await retryFailedEmailDeliveries();
    await reconcileScheduledReports(new Date(CRON_NOW.getTime() + 24 * 3600_000));

    const delivered = sentEmails().filter((e) => e.to.includes("ceo@alpha.example"));
    expect(delivered.some((e) => e.text.includes("alpha-legal-work"))).toBe(true);
  });

  it("the retry resends the identical subject and body, once, and then counts as the official send", async () => {
    const { scheduleA } = await twoClientsWithHours();
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "Resend 500" });
    await sendReportSchedule(scheduleA, computeReportingPeriod("WEEKLY", CRON_NOW), true);
    const [original] = sentEmails();

    vi.mocked(sendEmail).mockClear();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "retry" });
    expect(await retryFailedEmailDeliveries()).toEqual({ retried: 1, nowSent: 1 });

    const [resent] = sentEmails();
    expect(resent).toEqual({ to: ["ceo@alpha.example"], subject: original.subject, text: original.text });
    expect(resent.subject).not.toContain("התראת בנק שעות");
    // A report that went through on retry advances lastSentAt like a
    // first-time success, and is not sent a second time.
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleA.id } })).lastSentAt).not.toBeNull();
    vi.mocked(sendEmail).mockClear();
    await retryFailedEmailDeliveries();
    await reconcileScheduledReports(new Date(CRON_NOW.getTime() + 24 * 3600_000));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rebuilds a report failed before deliveries stored their text from the run's own snapshot", async () => {
    const { scheduleA } = await twoClientsWithHours();
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "Resend 500" });
    await sendReportSchedule(scheduleA, computeReportingPeriod("WEEKLY", CRON_NOW), true);
    const [original] = sentEmails();
    // A row as it was written before 7.10.2026: no subject, no body.
    await prisma.emailDelivery.updateMany({ data: { subject: null, body: null } });
    // Hours logged after the failure must not leak into the old report:
    // the rebuild uses the snapshot the run stored, not today's data.
    const late = await prisma.category.findFirstOrThrow({ where: { name: "alpha-legal-work" } });
    const { user: emp } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await createTestTimeEntry({
      userId: emp.id,
      clientId: scheduleA.clientId,
      categoryId: late.id,
      startAt: new Date("2026-09-29T08:00:00Z"),
      endAt: new Date("2026-09-29T18:00:00Z"),
    });

    vi.mocked(sendEmail).mockClear();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "retry" });
    expect(await retryFailedEmailDeliveries()).toEqual({ retried: 1, nowSent: 1 });
    const [resent] = sentEmails();
    expect(resent.subject).toBe(original.subject);
    expect(resent.text).toBe(original.text);
  });

  it("sends nothing and records nothing when the schedule has no recipients", async () => {
    const { admin, scheduleA } = await twoClientsWithHours();
    const emptied = await updateReportSchedule(admin, scheduleA.id, { recipients: ["  ", ""] });
    expect(emptied.recipients).toEqual([]);

    const result = await sendReportSchedule(emptied, computeReportingPeriod("WEEKLY", CRON_NOW), true);
    expect(result).toEqual({ sent: false, reason: "No recipients configured" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.reportRun.count()).toBe(0);
    expect(await prisma.emailDelivery.count()).toBe(0);
  });
});

describe("sendReportScheduleNow() - the admin test send never counts as the real one", () => {
  it("rejects an employee and a client user", async () => {
    const { employee, clientA, scheduleA } = await twoClientsWithHours();
    const { user: clientAdmin } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });

    await expect(sendReportScheduleNow(employee, scheduleA.id)).rejects.toThrow(ForbiddenError);
    await expect(sendReportScheduleNow(clientAdmin, scheduleA.id)).rejects.toThrow(ForbiddenError);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("mails the schedule's recipients as a test, without a ReportRun or lastSentAt, so the cron still sends the official report", async () => {
    const { admin, scheduleA } = await twoClientsWithHours();

    const result = await sendReportScheduleNow(admin, scheduleA.id);
    expect(result.sent).toBe(true);
    expect(sentEmails()[0].to).toEqual(["ceo@alpha.example"]);

    expect(await prisma.reportRun.count()).toBe(0);
    const delivery = await prisma.emailDelivery.findFirstOrThrow();
    expect(delivery.template).toBe("report.hours_by_category.test");
    expect(delivery.reportRunId).toBeNull();
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleA.id } })).lastSentAt).toBeNull();

    // The official send for the period still goes out afterwards.
    vi.mocked(sendEmail).mockClear();
    const cron = await reconcileScheduledReports(CRON_NOW);
    expect(cron.sent).toBe(2);
  });
});

describe("report schedule CRUD - Ankora admins only, and cadence fields stay consistent", () => {
  it("rejects employees and client users on list/create/update/delete", async () => {
    const { employee, clientA, scheduleA } = await twoClientsWithHours();
    const { user: clientAdmin } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });

    for (const actor of [employee, clientAdmin]) {
      await expect(listReportSchedulesForClient(actor, clientA.id)).rejects.toThrow(ForbiddenError);
      await expect(
        createReportSchedule(actor, clientA.id, { reportType: "MONTHLY_DETAILED", frequency: "MONTHLY", recipients: ["x@y.example"] })
      ).rejects.toThrow(ForbiddenError);
      await expect(updateReportSchedule(actor, scheduleA.id, { recipients: ["attacker@evil.example"] })).rejects.toThrow(ForbiddenError);
      await expect(deleteReportSchedule(actor, scheduleA.id)).rejects.toThrow(ForbiddenError);
    }

    const untouched = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleA.id } });
    expect(untouched.recipients).toEqual(["ceo@alpha.example"]);
  });

  it("lists only the requested client's schedules", async () => {
    const { admin, clientA, scheduleA } = await twoClientsWithHours();
    const listed = await listReportSchedulesForClient(admin, clientA.id);
    expect(listed.map((s) => s.id)).toEqual([scheduleA.id]);
  });

  it("normalizes recipients and clamps cadence fields on create", async () => {
    const { admin, clientA } = await twoClientsWithHours();
    const monthly = await createReportSchedule(admin, clientA.id, {
      reportType: "MONTHLY_DETAILED",
      frequency: "MONTHLY",
      dayOfWeek: 3, // ignored for MONTHLY
      dayOfMonth: 31, // there is no 31st in every month - clamped to 28
      hour: 30,
      recipients: [" CEO@Alpha.example ", "ceo@alpha.example", ""],
    });
    expect(monthly.recipients).toEqual(["ceo@alpha.example"]);
    expect(monthly.dayOfMonth).toBe(28);
    expect(monthly.dayOfWeek).toBeNull();
    expect(monthly.hour).toBe(23);
    expect(monthly.timezone).toBe("Asia/Jerusalem");

    expect(await prisma.auditEvent.count({ where: { action: "report_schedule.create", entityId: monthly.id } })).toBe(1);
  });

  it("switching cadence on update clears the field that no longer applies", async () => {
    const { admin, scheduleA } = await twoClientsWithHours();
    const monthly = await updateReportSchedule(admin, scheduleA.id, { frequency: "MONTHLY", dayOfMonth: 0 });
    expect(monthly.dayOfWeek).toBeNull();
    expect(monthly.dayOfMonth).toBe(1);

    const weekly = await updateReportSchedule(admin, scheduleA.id, { frequency: "WEEKLY", dayOfWeek: 4 });
    expect(weekly.dayOfMonth).toBeNull();
    expect(weekly.dayOfWeek).toBe(4);
  });

  it("deleting a schedule removes it and its run history, and audits the delete", async () => {
    const { admin, scheduleA } = await twoClientsWithHours();
    await reconcileScheduledReports(CRON_NOW);
    expect(await prisma.reportRun.count({ where: { scheduleId: scheduleA.id } })).toBe(1);

    await deleteReportSchedule(admin, scheduleA.id);
    expect(await prisma.reportSchedule.findUnique({ where: { id: scheduleA.id } })).toBeNull();
    expect(await prisma.reportRun.count({ where: { scheduleId: scheduleA.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "report_schedule.delete", entityId: scheduleA.id } })).toBe(1);
  });
});
