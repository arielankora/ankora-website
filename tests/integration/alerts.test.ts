import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestTimeEntry } from "./factories";
import { openHourBankCycle } from "@/lib/app-domain/hour-banks";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  evaluateAlertsForClient,
  retryEmailDelivery,
} from "@/lib/app-domain/alerts";

// Phase 4 - spec 9/9.1/9.2 (Alerts). Needs a real Prisma client +
// reachable DATABASE_URL, same as every other tests/integration/*.test.ts
// (see setup.ts's header). sendEmail is mocked so these tests never hit
// the real Resend API - both the SENT and FAILED code paths are
// exercised deterministically via the mock's return value.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}));
import { sendEmail } from "@/lib/email";

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const client = await createTestClient();
  return { superAdmin, admin, client };
}

async function openFutureBank(superAdmin: Awaited<ReturnType<typeof setup>>["superAdmin"], clientId: string, purchasedMinutes: number) {
  return openHourBankCycle(superAdmin, clientId, {
    cycleStart: new Date(Date.now() - 24 * 3600_000),
    cycleEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    purchasedMinutes,
    rolloverMode: "NONE",
  });
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "test-message-id" });
});

describe("createAlertRule() / updateAlertRule() / deleteAlertRule() - ADR 11.2 (SUPER_ADMIN only)", () => {
  it("rejects ANKORA_ADMIN even though it has client.manage", async () => {
    const { admin, client } = await setup();
    await expect(
      createAlertRule(admin, client.id, {
        type: "UTILIZATION_PCT",
        thresholdValue: 80,
        recipientsAnkora: ["ops@ankora.co.il"],
        recipientsClient: [],
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates a rule, records an audit event, and normalizes recipient emails", async () => {
    const { superAdmin, client } = await setup();
    const rule = await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: [" Ops@Ankora.co.il ", "ops@ankora.co.il"],
      recipientsClient: [],
    });

    expect(rule.recipientsAnkora).toEqual(["ops@ankora.co.il"]); // trimmed, lowercased, deduped

    const audit = await prisma.auditEvent.findFirst({ where: { action: "alert_rule.create", entityId: rule.id } });
    expect(audit).not.toBeNull();
  });

  it("updates and deletes a rule, each recording its own audit event", async () => {
    const { superAdmin, client } = await setup();
    const rule = await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: [],
    });

    const updated = await updateAlertRule(superAdmin, rule.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(await prisma.auditEvent.findFirst({ where: { action: "alert_rule.update", entityId: rule.id } })).not.toBeNull();

    await deleteAlertRule(superAdmin, rule.id);
    expect(await prisma.alertRule.findUnique({ where: { id: rule.id } })).toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { action: "alert_rule.delete", entityId: rule.id } })).not.toBeNull();
  });
});

describe("evaluateAlertsForClient() - ADR 11.3 dedupe/retrigger, end to end", () => {
  it("fires once when utilization crosses the threshold, sending to both recipient lists", async () => {
    const { superAdmin, client } = await setup();
    await openFutureBank(superAdmin, client.id, 100);
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 90 * 60_000), // 90 minutes -> 90% utilization
    });

    await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: ["finance@client.example"],
    });

    await evaluateAlertsForClient(client.id);

    const events = await prisma.alertEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].resolvedAt).toBeNull();
    expect(events[0].value).toBe(90);

    const deliveries = await prisma.emailDelivery.findMany({ where: { alertEventId: events[0].id } });
    expect(deliveries).toHaveLength(2); // ankora_internal + client_facing
    expect(deliveries.every((d) => d.status === "SENT")).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);

    // Re-evaluating while still breached and unresolved must not fire again.
    await evaluateAlertsForClient(client.id);
    expect(await prisma.alertEvent.count()).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("resolves an open event once consumption drops back below threshold, without sending an email for the resolve", async () => {
    const { superAdmin, client } = await setup();
    await openFutureBank(superAdmin, client.id, 100);
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const entry = await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 90 * 60_000),
    });

    await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: [],
    });

    await evaluateAlertsForClient(client.id);
    expect(await prisma.alertEvent.count()).toBe(1);
    vi.mocked(sendEmail).mockClear();

    // Simulate the entry being edited down to 10 minutes (well under threshold).
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { actualSeconds: 600, billableSeconds: 600 },
    });

    await evaluateAlertsForClient(client.id);

    const event = await prisma.alertEvent.findFirstOrThrow();
    expect(event.resolvedAt).not.toBeNull();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not refire after resolution unless allowRetrigger is true", async () => {
    const { superAdmin, client } = await setup();
    await openFutureBank(superAdmin, client.id, 100);
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const entry = await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 90 * 60_000),
    });

    await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: [],
      allowRetrigger: false,
    });

    await evaluateAlertsForClient(client.id); // fires
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { actualSeconds: 600, billableSeconds: 600 } });
    await evaluateAlertsForClient(client.id); // resolves
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { actualSeconds: 5400, billableSeconds: 5400 } });
    await evaluateAlertsForClient(client.id); // breaches again

    expect(await prisma.alertEvent.count()).toBe(1); // no second event - retrigger disabled
  });

  it("logs a FAILED EmailDelivery when the email provider errors, without throwing", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "Resend API error 500: boom" });

    const { superAdmin, client } = await setup();
    await openFutureBank(superAdmin, client.id, 100);
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 90 * 60_000),
    });

    await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: [],
    });

    await expect(evaluateAlertsForClient(client.id)).resolves.not.toThrow();

    const delivery = await prisma.emailDelivery.findFirstOrThrow();
    expect(delivery.status).toBe("FAILED");
    expect(delivery.error).toContain("boom");
  });
});

describe("retryEmailDelivery() - manual retry from the Alerts admin screen", () => {
  it("flips a FAILED delivery to SENT on a successful retry and records an audit event", async () => {
    const { superAdmin, client } = await setup();
    await openFutureBank(superAdmin, client.id, 100);
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 90 * 60_000),
    });

    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "temporary outage" });
    await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: [],
    });
    await evaluateAlertsForClient(client.id);

    const failed = await prisma.emailDelivery.findFirstOrThrow({ where: { status: "FAILED" } });

    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, providerMessageId: "retry-id" });
    const retried = await retryEmailDelivery(superAdmin, failed.id);

    expect(retried.status).toBe("SENT");
    expect(retried.attempts).toBe(2);
    expect(await prisma.auditEvent.findFirst({ where: { action: "email_delivery.retry", entityId: failed.id } })).not.toBeNull();
  });

  it("is SUPER_ADMIN only", async () => {
    const { admin, superAdmin, client } = await setup();
    await openFutureBank(superAdmin, client.id, 100);
    const category = await createTestCategory({ clientId: client.id });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await createTestTimeEntry({
      userId: employee.id,
      clientId: client.id,
      categoryId: category.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 90 * 60_000),
    });
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "boom" });
    await createAlertRule(superAdmin, client.id, {
      type: "UTILIZATION_PCT",
      thresholdValue: 80,
      recipientsAnkora: ["ops@ankora.co.il"],
      recipientsClient: [],
    });
    await evaluateAlertsForClient(client.id);
    const failed = await prisma.emailDelivery.findFirstOrThrow({ where: { status: "FAILED" } });

    await expect(retryEmailDelivery(admin, failed.id)).rejects.toThrow(ForbiddenError);
  });
});
