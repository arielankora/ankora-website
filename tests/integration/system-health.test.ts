import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// Silent failures plan, stages 2 and 3 (27.11.2026): the morning checks of
// what should have happened, and the morning report on system issues. A
// check that fails is an issue; one that passes closes its issue. The
// report goes to every admin every morning, also when all is well.

const account = vi.hoisted(() => ({ status: "running" }));
vi.mock("@/lib/comms/self-connect", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/comms/self-connect")>();
  return { ...real, readAccount: vi.fn(async () => ({ provider: "WHATSAPP", status: account.status, createdAt: null, userId: null })) };
});
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return { ...real, sendEmail: vi.fn(async () => ({ ok: true })) };
});

import { sendEmail } from "@/lib/email";
import { runHealthChecks } from "@/lib/system-health";
import { loadDigestData, renderSystemDigest, sendSystemDigest } from "@/lib/system-digest";
import { translatorFor } from "@/lib/i18n/outgoing";

const NOW = new Date("2026-11-28T04:30:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);
const issue = (key: string) => prisma.systemIssue.findUnique({ where: { area_key: { area: "health", key } } });

beforeEach(() => {
  account.status = "running";
  vi.mocked(sendEmail).mockClear();
});

describe("health checks: nightly jobs", () => {
  it("does not call a job missing while the run log is new", async () => {
    await runHealthChecks(NOW);
    expect(await issue("cron:mail-waits")).toBeNull();
  });

  it("reports a job with no run in 26 hours, and one cut off, once the log is older", async () => {
    await prisma.cronRun.create({ data: { job: "vault-rewrap", startedAt: ago(48), finishedAt: ago(48), ok: true } });
    await prisma.cronRun.create({ data: { job: "comms-recordings", startedAt: ago(4) } });
    await runHealthChecks(NOW);
    expect(await issue("cron:mail-waits")).toMatchObject({ severity: "CRITICAL", status: "OPEN" });
    expect(await issue("cron:vault-rewrap")).toMatchObject({ status: "OPEN" });
    expect((await issue("cron:comms-recordings"))?.title).toContain("נקטעה");
  });

  it("closes the issue when the job runs again", async () => {
    await prisma.cronRun.create({ data: { job: "vault-rewrap", startedAt: ago(48), finishedAt: ago(48), ok: true } });
    await runHealthChecks(NOW);
    await prisma.cronRun.create({ data: { job: "vault-rewrap", startedAt: ago(2), finishedAt: ago(2), ok: true } });
    await runHealthChecks(NOW);
    expect(await issue("cron:vault-rewrap")).toMatchObject({ status: "RESOLVED" });
  });
});

describe("health checks: WhatsApp, transcripts, reports, leads", () => {
  it("reports a stored number Unipile has disconnected, and one with no message in 48 hours", async () => {
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_x", ownerUserId: user.id, storeEnabled: true } });
    const conversation = await prisma.commsConversation.create({ data: { channelId: channel.id, externalChatId: "c1", name: "x" } });
    await prisma.commsMessage.create({ data: { conversationId: conversation.id, externalId: "m1", at: ago(72) } });
    account.status = "disconnected";
    await runHealthChecks(NOW);
    expect(await issue(`whatsapp-account:${channel.id}`)).toMatchObject({ severity: "CRITICAL", status: "OPEN" });
    expect((await issue(`whatsapp-account:${channel.id}`))?.title).toContain("צריך לחבר מחדש");
    expect(await issue(`whatsapp-quiet:${channel.id}`)).toMatchObject({ severity: "WARNING", status: "OPEN" });

    account.status = "running";
    await prisma.commsMessage.create({ data: { conversationId: conversation.id, externalId: "m2", at: ago(1) } });
    await runHealthChecks(NOW);
    expect(await issue(`whatsapp-account:${channel.id}`)).toMatchObject({ status: "RESOLVED" });
    expect(await issue(`whatsapp-quiet:${channel.id}`)).toMatchObject({ status: "RESOLVED" });
  });

  it("reports transcripts waiting more than a day, overdue reports and undelivered leads", async () => {
    const recording = await prisma.callRecording.create({
      data: { emailId: "e1", mailAccountId: "acc_mail", fromPhone: "+972500000001", toPhone: "+972500000002", otherPhone: "+972500000001", direction: "IN", callAt: ago(30), createdAt: ago(30), transcript: { create: { status: "PENDING", createdAt: ago(30) } } },
    });
    const client = await createTestClient({ name: "לקוח דוחות" });
    await prisma.reportSchedule.create({ data: { clientId: client.id, reportType: "HOURS_BY_CATEGORY", frequency: "WEEKLY", dayOfWeek: 0, recipients: ["a@x.example"], createdAt: ago(24 * 20), lastSentAt: ago(24 * 10) } });
    await prisma.websiteLead.create({ data: { name: "x", email: "x@x.example", emailStatus: "FAILED", createdAt: ago(3) } });

    const { failed } = await runHealthChecks(NOW);
    expect(failed).toBeGreaterThanOrEqual(3);
    expect(await issue("transcripts-stuck")).toMatchObject({ severity: "CRITICAL" });
    const report = await prisma.systemIssue.findFirstOrThrow({ where: { area: "health", key: { startsWith: "report-overdue:" } } });
    expect(report.title).toContain("לקוח דוחות");
    expect(await issue("leads-undelivered")).toMatchObject({ severity: "CRITICAL" });
    expect(recording.id).toBeTruthy();
  });
});

describe("the morning report", () => {
  it("says all is well when nothing is open, with the nightly runs, to every admin", async () => {
    await createTestUser({ role: "SUPER_ADMIN", email: "boss@ankora.test" });
    await createTestUser({ role: "ANKORA_ADMIN", email: "ops-admin@ankora.test" });
    await createTestUser({ role: "ANKORA_EMPLOYEE", email: "worker@ankora.test" });
    const result = await sendSystemDigest(NOW);
    expect(result).toEqual({ sent: 2, open: 0 });
    const calls = vi.mocked(sendEmail).mock.calls.map(([e]) => e);
    expect(calls.map((c) => c.to[0]).sort()).toEqual(["boss@ankora.test", "ops-admin@ankora.test"]);
    expect(calls[0].subject).toContain("הכל תקין");
    expect(calls[0].text).toContain("comms-recordings");
  });

  it("lists open issues as new or recurring, and ones that closed by themselves", async () => {
    await prisma.systemIssue.create({ data: { area: "comms", key: "a", title: "תמלול נכשל", severity: "CRITICAL", firstSeenAt: ago(2), lastSeenAt: ago(1) } });
    await prisma.systemIssue.create({ data: { area: "email", key: "b", title: "מייל לא נשלח", severity: "WARNING", count: 4, firstSeenAt: ago(72), lastSeenAt: ago(5) } });
    await prisma.systemIssue.create({ data: { area: "cron", key: "c", title: "שלב נכשל", severity: "CRITICAL", status: "RESOLVED", resolvedAt: ago(3), firstSeenAt: ago(30), lastSeenAt: ago(28) } });
    const data = await loadDigestData(NOW);
    const { subject, html, text } = renderSystemDigest(data, NOW, translatorFor("he", "Asia/Jerusalem"));
    expect(subject).toContain("2 פתוחות");
    expect(text).toContain("[חדשה] comms: תמלול נכשל");
    expect(text).toContain("[חוזרת] email: מייל לא נשלח");
    expect(text).toContain("[נסגרה לבד] cron: שלב נכשל");
    expect(html).toContain("<table");
    expect(html).toContain("/app/system-issues");
    const en = renderSystemDigest(data, NOW, translatorFor("en", "Asia/Jerusalem"));
    expect(en.subject).toContain("2 open");
  });
});
