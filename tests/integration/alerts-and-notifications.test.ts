import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import { openHourBankCycle } from "@/lib/app-domain/hour-banks";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createAlertRule,
  countOpenAlertEvents,
  listOpenAlertEvents,
  listAlertRulesForClient,
  resolveAlertEvent,
  unresolveAlertEvent,
  retryFailedEmailDeliveries,
  retryEmailDelivery,
  reconcileAllClientAlerts,
} from "@/lib/app-domain/alerts";
import { sendVaultAlert } from "@/lib/vault/alerts";
import {
  listNotificationsForUser,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  notifyLongRunningTimers,
  LONG_TIMER_NOTIFICATION_TYPE,
} from "@/lib/app-domain/notifications";
import type { User } from "@prisma/client";

// The other half of the alerts cron (app/api/cron/alerts-reconcile): the
// daily re-evaluation of every client's hour-bank alerts, the retry of
// failed alert emails, the long-running-timer sweep, and the per-user
// notification bell those feed. tests/integration/alerts.test.ts already
// covers rule CRUD, evaluateAlertsForClient()'s fire/resolve/retrigger
// branching and the manual single-delivery retry; this file covers the
// cron-level and admin-screen functions around them.
//
// The properties that matter to a person: an alert email is sent once per
// crossing (not once per cron run), it reaches only that client's
// recipients, only a SUPER_ADMIN can close one, and nobody can read or
// clear somebody else's notifications.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}));
import { sendEmail } from "@/lib/email";

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "msg" });
});

/// A client with a 100-minute cycle, `consumed` minutes logged against it,
/// and one UTILIZATION_PCT >= 80 rule mailing `ankora`/`client` addresses.
async function clientWithBreachableRule(
  superAdmin: User,
  opts: { name: string; consumed: number; ankora: string; client: string }
) {
  const client = await createTestClient({ name: opts.name });
  await openHourBankCycle(superAdmin, client.id, {
    cycleStart: new Date(Date.now() - 24 * 3600_000),
    cycleEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    purchasedMinutes: 100,
    rolloverMode: "NONE",
  });
  const category = await createTestCategory({ clientId: client.id });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const entry = await createTestTimeEntry({
    userId: employee.id,
    clientId: client.id,
    categoryId: category.id,
    startAt: new Date(Date.now() - 2 * 3600_000),
    endAt: new Date(Date.now() - 2 * 3600_000 + opts.consumed * 60_000),
  });
  const rule = await createAlertRule(superAdmin, client.id, {
    type: "UTILIZATION_PCT",
    thresholdValue: 80,
    recipientsAnkora: [opts.ankora],
    recipientsClient: [opts.client],
  });
  return { client, rule, entry };
}

describe("reconcileAllClientAlerts() - the daily cron alerts once per crossing, per client", () => {
  it("alerts the breached client only, to its own recipients, and a second run sends nothing", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const hot = await clientWithBreachableRule(superAdmin, { name: "Hot Client", consumed: 90, ankora: "ops@ankora.test", client: "cfo@hot.example" });
    const calm = await clientWithBreachableRule(superAdmin, { name: "Calm Client", consumed: 20, ankora: "ops@ankora.test", client: "cfo@calm.example" });

    const first = await reconcileAllClientAlerts();
    expect(first.clientsEvaluated).toBe(2);

    const events = await prisma.alertEvent.findMany();
    expect(events.map((e) => e.ruleId)).toEqual([hot.rule.id]);

    const recipients = vi.mocked(sendEmail).mock.calls.flatMap(([i]) => i.to);
    expect(recipients.sort()).toEqual(["cfo@hot.example", "ops@ankora.test"]);
    const clientFacing = vi.mocked(sendEmail).mock.calls.map(([i]) => i).find((i) => i.to.includes("cfo@hot.example"))!;
    expect(clientFacing.subject).toContain("Hot Client");
    expect(clientFacing.text).not.toContain("Calm Client");

    // Same threshold, still breached, next day's cron: no second email.
    await reconcileAllClientAlerts();
    expect(await prisma.alertEvent.count()).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    void calm;
  });

  it("keeps evaluating a client whose cycle has expired (the 'nobody renewed' case)", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const client = await createTestClient({ name: "Expired Client" });
    // A cycle that ended yesterday, already 90% used.
    const bank = await prisma.hourBank.create({
      data: {
        clientId: client.id,
        cycleStart: new Date(Date.now() - 31 * 24 * 3600_000),
        cycleEnd: new Date(Date.now() - 24 * 3600_000),
        purchasedMinutes: 100,
        status: "CLOSED",
      },
    });
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - 10 * 24 * 3600_000),
      endAt: new Date(Date.now() - 10 * 24 * 3600_000 + 90 * 60_000),
    });
    await createAlertRule(superAdmin, client.id, { type: "UTILIZATION_PCT", thresholdValue: 80, recipientsAnkora: ["ops@ankora.test"], recipientsClient: [] });

    const result = await reconcileAllClientAlerts();
    expect(result.clientsEvaluated).toBe(1);
    const event = await prisma.alertEvent.findFirstOrThrow();
    expect(event.hourBankId).toBe(bank.id);
  });

  it("ignores soft-deleted hour banks", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const hot = await clientWithBreachableRule(superAdmin, { name: "Deleted Bank", consumed: 90, ankora: "ops@ankora.test", client: "cfo@x.example" });
    await prisma.hourBank.updateMany({ where: { clientId: hot.client.id }, data: { deletedAt: new Date() } });

    const result = await reconcileAllClientAlerts();
    expect(result.clientsEvaluated).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("open alerts on the admin screens - countOpenAlertEvents / listOpenAlertEvents / listAlertRulesForClient", () => {
  it("counts and lists only unresolved events, newest first, each with its client", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const a = await clientWithBreachableRule(superAdmin, { name: "Client A", consumed: 90, ankora: "ops@ankora.test", client: "a@a.example" });
    const b = await clientWithBreachableRule(superAdmin, { name: "Client B", consumed: 90, ankora: "ops@ankora.test", client: "b@b.example" });
    await reconcileAllClientAlerts();
    const events = await prisma.alertEvent.findMany();
    expect(events).toHaveLength(2);
    // Make the ordering deterministic: A's event is the older one.
    const eventA = events.find((e) => e.ruleId === a.rule.id)!;
    const eventB = events.find((e) => e.ruleId === b.rule.id)!;
    await prisma.alertEvent.update({ where: { id: eventA.id }, data: { triggeredAt: new Date(Date.now() - 3600_000) } });

    expect(await countOpenAlertEvents()).toBe(2);
    const open = await listOpenAlertEvents();
    expect(open.map((e) => e.id)).toEqual([eventB.id, eventA.id]);
    expect(open.map((e) => e.rule.client.name)).toEqual(["Client B", "Client A"]);

    await resolveAlertEvent(superAdmin, eventB.id);
    expect(await countOpenAlertEvents()).toBe(1);
    expect((await listOpenAlertEvents()).map((e) => e.id)).toEqual([eventA.id]);
  });

  it("lists one client's rules with their events and deliveries, never another client's", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const a = await clientWithBreachableRule(superAdmin, { name: "Client A", consumed: 90, ankora: "ops@ankora.test", client: "a@a.example" });
    await clientWithBreachableRule(superAdmin, { name: "Client B", consumed: 90, ankora: "ops@ankora.test", client: "b@b.example" });
    await reconcileAllClientAlerts();

    const rules = await listAlertRulesForClient(a.client.id);
    expect(rules.map((r) => r.id)).toEqual([a.rule.id]);
    expect(rules[0].events).toHaveLength(1);
    const delivered = rules[0].events[0].emailDeliveries.flatMap((d) => d.recipients).sort();
    expect(delivered).toEqual(["a@a.example", "ops@ankora.test"]);
  });
});

describe("resolveAlertEvent() / unresolveAlertEvent() - SUPER_ADMIN only, and closing by hand does not re-alert", () => {
  it("rejects ANKORA_ADMIN, employees and client users, leaving the event open", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const hot = await clientWithBreachableRule(superAdmin, { name: "Hot", consumed: 90, ankora: "ops@ankora.test", client: "c@hot.example" });
    await reconcileAllClientAlerts();
    const event = await prisma.alertEvent.findFirstOrThrow();

    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: clientUser } = await createTestUser({ role: "CLIENT_USER" });
    for (const actor of [admin, employee, clientUser]) {
      await expect(resolveAlertEvent(actor, event.id)).rejects.toThrow(ForbiddenError);
    }
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: event.id } })).resolvedAt).toBeNull();

    await resolveAlertEvent(superAdmin, event.id);
    for (const actor of [admin, employee, clientUser]) {
      await expect(unresolveAlertEvent(actor, event.id)).rejects.toThrow(ForbiddenError);
    }
    expect((await prisma.alertEvent.findUniqueOrThrow({ where: { id: event.id } })).resolvedAt).not.toBeNull();
    void hot;
  });

  it("a manually resolved alert that is still breached is not re-sent by the next cron, and undo restores it without a duplicate", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    await clientWithBreachableRule(superAdmin, { name: "Hot", consumed: 90, ankora: "ops@ankora.test", client: "c@hot.example" });
    await reconcileAllClientAlerts();
    const event = await prisma.alertEvent.findFirstOrThrow();
    vi.mocked(sendEmail).mockClear();

    await resolveAlertEvent(superAdmin, event.id);
    await reconcileAllClientAlerts();
    expect(await prisma.alertEvent.count()).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();

    const reopened = await unresolveAlertEvent(superAdmin, event.id);
    expect(reopened.resolvedAt).toBeNull();
    await reconcileAllClientAlerts();
    expect(await prisma.alertEvent.count()).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: event.id } })).map((a) => a.action).sort();
    expect(actions).toEqual(["alert_event.reopen", "alert_event.resolve"]);
  });
});

describe("retryFailedEmailDeliveries() - failed alert emails are retried to the same people, up to five attempts", () => {
  it("retries a failed delivery to its original recipients and marks it SENT", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "provider down" });
    await clientWithBreachableRule(superAdmin, { name: "Hot", consumed: 90, ankora: "ops@ankora.test", client: "c@hot.example" });
    await reconcileAllClientAlerts();
    expect(await prisma.emailDelivery.count({ where: { status: "FAILED" } })).toBe(2);

    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "retry-ok" });
    const result = await retryFailedEmailDeliveries();
    expect(result).toEqual({ retried: 2, nowSent: 2 });
    expect(vi.mocked(sendEmail).mock.calls.map(([i]) => i.to).sort()).toEqual([["c@hot.example"], ["ops@ankora.test"]]);

    const deliveries = await prisma.emailDelivery.findMany();
    expect(deliveries.every((d) => d.status === "SENT" && d.attempts === 2 && d.error === null)).toBe(true);

    // Nothing left to retry: a SENT delivery is never sent again.
    vi.mocked(sendEmail).mockClear();
    expect(await retryFailedEmailDeliveries()).toEqual({ retried: 0, nowSent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stops retrying after the fifth attempt", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "bounced" });
    const hot = await clientWithBreachableRule(superAdmin, { name: "Hot", consumed: 90, ankora: "ops@ankora.test", client: "c@hot.example" });
    await prisma.alertRule.update({ where: { id: hot.rule.id }, data: { recipientsClient: [] } });
    await reconcileAllClientAlerts(); // attempt 1
    vi.mocked(sendEmail).mockClear();

    for (let day = 0; day < 6; day++) await retryFailedEmailDeliveries();

    expect(sendEmail).toHaveBeenCalledTimes(4); // attempts 2..5
    const delivery = await prisma.emailDelivery.findFirstOrThrow();
    expect(delivery.attempts).toBe(5);
    expect(delivery.status).toBe("FAILED");
    expect(delivery.error).toBe("bounced");
  });
});

// 7.10.2026: both retry paths used to send a fixed
// "[Ankora] התראת בנק שעות (ניסיון חוזר)" stub, naming the internal
// template, whatever had failed: a client's hour-bank update, a vault
// alert, a weekly report. A retry now resends the message that failed, and
// a row with nothing truthful to resend is left alone rather than stubbed.
describe("email retries resend the message that failed, never a stand-in", () => {
  it("resends a client-facing alert with its original subject and text", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "provider down" });
    await clientWithBreachableRule(superAdmin, { name: "Hot", consumed: 90, ankora: "ops@ankora.test", client: "c@hot.example" });
    await reconcileAllClientAlerts();
    const originals = vi.mocked(sendEmail).mock.calls.map(([i]) => i);

    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "retry-ok" });
    await retryFailedEmailDeliveries();
    const resent = vi.mocked(sendEmail).mock.calls.map(([i]) => i);

    const byRecipient = (list: typeof originals) => Object.fromEntries(list.map((i) => [i.to.join(","), i]));
    expect(byRecipient(resent)).toEqual(byRecipient(originals));
    const toClient = byRecipient(resent)["c@hot.example"];
    expect(toClient.subject).toBe("עדכון ניצול שעות - Hot");
    expect(toClient.text).not.toContain("client_facing");
  });

  it("resends a failed vault alert as the vault alert it was", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "provider down" });
    await sendVaultAlert("נעילת אימות", ["משתמש: test", "ניסיונות: 5"]);
    const [original] = vi.mocked(sendEmail).mock.calls.map(([i]) => i);

    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "retry-ok" });
    expect(await retryFailedEmailDeliveries()).toEqual({ retried: 1, nowSent: 1 });
    const [resent] = vi.mocked(sendEmail).mock.calls.map(([i]) => i);
    expect(resent).toEqual(original);
    expect(resent.subject).toBe("כספת הגישות: נעילת אימות");
  });

  it("never retries the nightly backup, whose attachments were not kept", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const backup = await prisma.emailDelivery.create({
      data: { template: "backup.nightly_export", recipients: ["ops@ankora.test"], subject: "גיבוי", body: "counts", status: "FAILED", error: "x" },
    });

    expect(await retryFailedEmailDeliveries()).toEqual({ retried: 0, nowSent: 0 });
    await expect(retryEmailDelivery(superAdmin, backup.id)).rejects.toThrow("אי אפשר לשלוח אותה שוב");
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: backup.id } })).attempts).toBe(1);
  });

  it("leaves an old row with no stored text alone instead of mailing a stub", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const legacy = await prisma.emailDelivery.create({
      data: { template: "client_facing", recipients: ["c@hot.example"], status: "FAILED", error: "x" },
    });

    expect(await retryFailedEmailDeliveries()).toEqual({ retried: 0, nowSent: 0 });
    await expect(retryEmailDelivery(superAdmin, legacy.id)).rejects.toThrow("אין עותק של ההודעה המקורית");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the manual retry audits who retried and the outcome, without copying the message into the audit", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const row = await prisma.emailDelivery.create({
      data: { template: "client_facing", recipients: ["c@hot.example"], subject: "s", body: "private body text", status: "FAILED", error: "x" },
    });

    const updated = await retryEmailDelivery(superAdmin, row.id);
    expect(updated.status).toBe("SENT");
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toEqual({ to: ["c@hot.example"], subject: "s", text: "private body text" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "email_delivery.retry", entityId: row.id } });
    expect(audit.actorId).toBe(superAdmin.id);
    expect(JSON.stringify(audit)).not.toContain("private body text");
  });
});

describe("notifications - each user sees and clears only their own", () => {
  async function twoUsersWithNotifications() {
    const { user: x } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: y } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const mk = (userId: string, title: string, createdAt: Date) =>
      prisma.notification.create({ data: { userId, type: "test", title, body: title, createdAt } });
    const x1 = await mk(x.id, "x-old", new Date("2026-10-01T08:00:00Z"));
    const x2 = await mk(x.id, "x-new", new Date("2026-10-02T08:00:00Z"));
    const y1 = await mk(y.id, "y-private", new Date("2026-10-03T08:00:00Z"));
    return { x, y, x1, x2, y1 };
  }

  it("lists only my notifications, newest first, and counts only my unread", async () => {
    const { x, y } = await twoUsersWithNotifications();
    expect((await listNotificationsForUser(x.id)).map((n) => n.title)).toEqual(["x-new", "x-old"]);
    expect((await listNotificationsForUser(y.id)).map((n) => n.title)).toEqual(["y-private"]);
    expect(await unreadNotificationCount(x.id)).toBe(2);
    expect(await unreadNotificationCount(y.id)).toBe(1);
  });

  it("caps the list at the newest 100", async () => {
    const { user: x } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.notification.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        userId: x.id,
        type: "test",
        title: `n${i}`,
        body: "",
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    });
    const list = await listNotificationsForUser(x.id);
    expect(list).toHaveLength(100);
    expect(list[0].title).toBe("n104");
    expect(await unreadNotificationCount(x.id)).toBe(105);
  });

  it("markNotificationRead: user X cannot mark user Y's notification as read", async () => {
    const { x, y, x1, y1 } = await twoUsersWithNotifications();

    await markNotificationRead(x, y1.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: y1.id } })).readAt).toBeNull();
    expect(await unreadNotificationCount(y.id)).toBe(1);

    await markNotificationRead(x, x1.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: x1.id } })).readAt).not.toBeNull();
    expect(await unreadNotificationCount(x.id)).toBe(1);
  });

  it("markAllNotificationsRead clears only mine", async () => {
    const { x, y } = await twoUsersWithNotifications();
    await markAllNotificationsRead(x);
    expect(await unreadNotificationCount(x.id)).toBe(0);
    expect(await unreadNotificationCount(y.id)).toBe(1);
  });
});

describe("notifyLongRunningTimers() - the timer's owner is told once, by email only if they want it", () => {
  async function runningTimer(opts: { hoursAgo: number; emailPref?: boolean; clientName?: string }) {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    if (opts.emailPref === false) {
      await prisma.user.update({ where: { id: user.id }, data: { notifyLongRunningTimerByEmail: false } });
    }
    const client = await createTestClient({ name: opts.clientName });
    const category = await createTestCategory({ clientId: client.id });
    const entry = await createTestTimeEntry({
      userId: user.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(Date.now() - opts.hoursAgo * 3600_000),
      endAt: null,
      source: "TIMER",
      isManual: false,
    });
    return { user, client, entry };
  }

  it("notifies the owner of a timer past 8 hours, and nobody about a younger, stopped or deleted one", async () => {
    const long = await runningTimer({ hoursAgo: 9, clientName: "Long Client" });
    const young = await runningTimer({ hoursAgo: 7 });
    const deleted = await runningTimer({ hoursAgo: 12 });
    await prisma.timeEntry.update({ where: { id: deleted.entry.id }, data: { deletedAt: new Date() } });
    const stopped = await runningTimer({ hoursAgo: 12 });
    await prisma.timeEntry.update({ where: { id: stopped.entry.id }, data: { endAt: new Date() } });

    const result = await notifyLongRunningTimers();
    expect(result.notified).toBe(1);

    const notes = await prisma.notification.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(long.user.id);
    expect(notes[0].type).toBe(LONG_TIMER_NOTIFICATION_TYPE);
    expect(notes[0].entityId).toBe(long.entry.id);
    expect(notes[0].body).toContain("Long Client");
    expect(notes[0].body).toContain("9 שעות");

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toEqual([long.user.email]);
    void young;
  });

  it("does not notify the same timer twice across cron runs", async () => {
    await runningTimer({ hoursAgo: 9 });
    await notifyLongRunningTimers();
    const second = await notifyLongRunningTimers();
    expect(second.notified).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("still shows the bell notification but sends no email when the user opted out", async () => {
    const { user } = await runningTimer({ hoursAgo: 9, emailPref: false });
    await notifyLongRunningTimers();
    expect(await unreadNotificationCount(user.id)).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
