import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { sendEmail } from "@/lib/email";
import { getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import type { User, AlertRule, AlertThresholdType, HourBank } from "@prisma/client";

// Phase 4 domain service: spec sections 9 ("התראות") and 9.1/9.2 (threshold
// types, delivery). See docs/adr/0001 section 11 for every decision this
// file encodes where the spec itself is silent (dedupe/retrigger algorithm,
// EmailDelivery granularity, recipient storage, retry cadence).

// ---------------------------------------------------------------------------
// Alert rule CRUD (SUPER_ADMIN only, per ADR 11.2)
// ---------------------------------------------------------------------------

export interface AlertRuleInput {
  type: AlertThresholdType;
  thresholdValue: number;
  recipientsAnkora: string[];
  recipientsClient: string[];
  enabled?: boolean;
  allowRetrigger?: boolean;
}

function normalizeEmails(emails: string[]): string[] {
  return Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0))
  );
}

/// Phase 5 Overview KPI card ("alerts" per spec section 12) - a simple
/// count of currently-open (unresolved) alert events across every client,
/// reusing the same resolvedAt-based state Phase 4 already tracks rather
/// than introducing a parallel "is this bad right now" concept.
export async function countOpenAlertEvents(): Promise<number> {
  return prisma.alertEvent.count({ where: { resolvedAt: null } });
}

export async function listAlertRulesForClient(clientId: string) {
  return prisma.alertRule.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: { events: { orderBy: { triggeredAt: "desc" }, take: 10, include: { emailDeliveries: true } } },
  });
}

export async function createAlertRule(actor: User, clientId: string, input: AlertRuleInput) {
  assertCan(actor.role, "alert.manage");

  const rule = await prisma.alertRule.create({
    data: {
      clientId,
      type: input.type,
      thresholdValue: Math.round(input.thresholdValue),
      recipientsAnkora: normalizeEmails(input.recipientsAnkora),
      recipientsClient: normalizeEmails(input.recipientsClient),
      enabled: input.enabled ?? true,
      allowRetrigger: input.allowRetrigger ?? false,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "alert_rule.create",
    entityType: "AlertRule",
    entityId: rule.id,
    clientId,
    after: rule,
  });

  return rule;
}

export async function updateAlertRule(actor: User, ruleId: string, input: Partial<AlertRuleInput>) {
  assertCan(actor.role, "alert.manage");

  const before = await prisma.alertRule.findUniqueOrThrow({ where: { id: ruleId } });

  const rule = await prisma.alertRule.update({
    where: { id: ruleId },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.thresholdValue !== undefined ? { thresholdValue: Math.round(input.thresholdValue) } : {}),
      ...(input.recipientsAnkora !== undefined ? { recipientsAnkora: normalizeEmails(input.recipientsAnkora) } : {}),
      ...(input.recipientsClient !== undefined ? { recipientsClient: normalizeEmails(input.recipientsClient) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.allowRetrigger !== undefined ? { allowRetrigger: input.allowRetrigger } : {}),
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "alert_rule.update",
    entityType: "AlertRule",
    entityId: rule.id,
    clientId: rule.clientId,
    before,
    after: rule,
  });

  return rule;
}

export async function deleteAlertRule(actor: User, ruleId: string) {
  assertCan(actor.role, "alert.manage");

  const before = await prisma.alertRule.findUniqueOrThrow({ where: { id: ruleId } });
  await prisma.alertRule.delete({ where: { id: ruleId } });

  await recordAudit({
    actorId: actor.id,
    action: "alert_rule.delete",
    entityType: "AlertRule",
    entityId: ruleId,
    clientId: before.clientId,
    before,
  });

  return before;
}

// ---------------------------------------------------------------------------
// Threshold evaluation (pure function - unit-testable without a database)
// ---------------------------------------------------------------------------

export interface UtilizationSnapshotForAlerts {
  totalMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  utilizationPct: number;
}

/// Spec 9.1's four threshold types, each read off the same utilization
/// snapshot Hour Banks already computes (lib/app-domain/hour-banks.ts).
/// "Forecast" is deliberately excluded - spec 9.1 itself marks that row
/// "Future" (see ADR 11.5).
export function currentValueForThreshold(
  type: AlertThresholdType,
  snapshot: UtilizationSnapshotForAlerts
): number {
  switch (type) {
    case "UTILIZATION_PCT":
      return snapshot.utilizationPct;
    case "REMAINING_MINUTES":
      return snapshot.remainingMinutes;
    case "CONSUMED_MINUTES":
      return snapshot.consumedMinutes;
    case "OVERAGE":
      return Math.max(0, snapshot.consumedMinutes - snapshot.totalMinutes);
    default:
      return 0;
  }
}

/// Whether a rule should be considered "crossed" (breached) at the given
/// current value. REMAINING_MINUTES is the one inverted case - a rule
/// fires when remaining time drops TO OR BELOW the threshold, every other
/// type fires when its value rises to or above the threshold.
export function isThresholdBreached(type: AlertThresholdType, thresholdValue: number, currentValue: number): boolean {
  if (type === "REMAINING_MINUTES") {
    return currentValue <= thresholdValue;
  }
  return currentValue >= thresholdValue;
}

// ---------------------------------------------------------------------------
// Dedupe / retrigger + evaluation (ADR 11.3)
// ---------------------------------------------------------------------------

/// Core per-rule decision, factored out as a pure function so the
/// fire/resolve/no-op branching is unit-testable without touching
/// Prisma. `openUnresolvedEvent` is the most recent AlertEvent for this
/// (ruleId, hourBankId) pair that has resolvedAt === null, if any.
export function decideAlertAction(
  breached: boolean,
  allowRetrigger: boolean,
  hasAnyPriorEvent: boolean,
  openUnresolvedEvent: boolean
): "fire" | "resolve" | "none" {
  if (breached) {
    if (openUnresolvedEvent) return "none"; // already firing, not resolved yet
    if (!hasAnyPriorEvent) return "fire"; // first time this pair ever crosses
    if (allowRetrigger) return "fire"; // crossed again after having resolved
    return "none"; // already fired once, retrigger disabled
  }
  // Not breached: clear any open event, otherwise nothing to do.
  return openUnresolvedEvent ? "resolve" : "none";
}

function formatThresholdLabel(type: AlertThresholdType): string {
  switch (type) {
    case "UTILIZATION_PCT":
      return "ניצול (%)";
    case "REMAINING_MINUTES":
      return "דקות שנותרו";
    case "CONSUMED_MINUTES":
      return "דקות שנוצלו";
    case "OVERAGE":
      return "חריגה (דקות)";
  }
}

async function deliverAlertEmail(
  alertEventId: string,
  template: "ankora_internal" | "client_facing",
  recipients: string[],
  subject: string,
  text: string
) {
  if (recipients.length === 0) return;

  const result = await sendEmail({ to: recipients, subject, text });

  await prisma.emailDelivery.create({
    data: {
      alertEventId,
      template,
      recipients,
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.ok ? result.providerMessageId ?? null : null,
      error: result.ok ? null : result.error ?? "Unknown error",
      attempts: 1,
    },
  });
}

/// Evaluates every enabled AlertRule for a client's CURRENT hour-bank
/// cycle. Called best-effort (non-fatal) from time-entry and hour-bank
/// mutations, plus once daily from the reconciliation cron. Never throws:
/// callers wrap this in `.catch(console.error)` so a failure here must
/// never roll back the primary write that triggered it.
export async function evaluateAlertsForClient(clientId: string): Promise<void> {
  const rules = await prisma.alertRule.findMany({ where: { clientId, enabled: true } });
  if (rules.length === 0) return;

  const snapshot = await getCurrentHourBank(clientId);
  if (!snapshot) return; // no open/known cycle - nothing to evaluate against

  const { bank, utilization } = snapshot;
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return;

  for (const rule of rules) {
    await evaluateSingleRule(rule, bank, utilization, client.name);
  }
}

async function evaluateSingleRule(
  rule: AlertRule,
  bank: Pick<HourBank, "id">,
  utilization: UtilizationSnapshotForAlerts,
  clientName: string
): Promise<void> {
  const currentValue = currentValueForThreshold(rule.type, utilization);
  const breached = isThresholdBreached(rule.type, rule.thresholdValue, currentValue);

  const priorEvents = await prisma.alertEvent.findMany({
    where: { ruleId: rule.id, hourBankId: bank.id },
    orderBy: { triggeredAt: "desc" },
  });
  const openEvent = priorEvents.find((e) => e.resolvedAt === null) ?? null;

  const action = decideAlertAction(breached, rule.allowRetrigger, priorEvents.length > 0, openEvent !== null);

  if (action === "resolve" && openEvent) {
    await prisma.alertEvent.update({ where: { id: openEvent.id }, data: { resolvedAt: new Date() } });
    return; // spec 9.2: no email is sent for the resolve itself.
  }

  if (action !== "fire") return;

  const event = await prisma.alertEvent.create({
    data: { ruleId: rule.id, hourBankId: bank.id, value: Math.round(currentValue) },
  });

  const label = formatThresholdLabel(rule.type);
  const subjectAnkora = `[Ankora] התראת בנק שעות - ${clientName}`;
  const textAnkora = [
    `לקוח: ${clientName}`,
    `סוג התראה: ${label}`,
    `סף: ${rule.thresholdValue}`,
    `ערך נוכחי: ${Math.round(currentValue)}`,
    `ניצול: ${utilization.utilizationPct}% (${utilization.consumedMinutes}/${utilization.totalMinutes} דקות)`,
  ].join("\n");

  const subjectClient = `עדכון ניצול שעות - ${clientName}`;
  // Deliberately omits a "link to portal" line (spec 9.2) - no Client
  // Portal exists yet (ADR 11.5 / Phase 6 gap).
  const textClient = [
    `שלום,`,
    ``,
    `זהו עדכון אוטומטי על ניצול בנק השעות שלכם אצל Ankora.`,
    `ניצול נוכחי: ${utilization.utilizationPct}%`,
    `דקות שנותרו: ${utilization.remainingMinutes}`,
    ``,
    `בברכה,`,
    `צוות Ankora`,
  ].join("\n");

  await Promise.all([
    deliverAlertEmail(event.id, "ankora_internal", rule.recipientsAnkora, subjectAnkora, textAnkora),
    deliverAlertEmail(event.id, "client_facing", rule.recipientsClient, subjectClient, textClient),
  ]);
}

// ---------------------------------------------------------------------------
// Retry (used by the daily reconciliation cron - Task #146)
// ---------------------------------------------------------------------------

const MAX_EMAIL_ATTEMPTS = 5;

/// Retries every FAILED EmailDelivery under the attempt cap. Coarser than
/// spec 9.2's "exponential backoff" ideal - see ADR 11.3 - but this is the
/// only retry mechanism available without a job queue or sub-daily
/// scheduler in this stack.
export async function retryFailedEmailDeliveries(): Promise<{ retried: number; nowSent: number }> {
  const failed = await prisma.emailDelivery.findMany({
    where: { status: "FAILED", attempts: { lt: MAX_EMAIL_ATTEMPTS } },
  });

  let nowSent = 0;
  for (const delivery of failed) {
    const result = await sendEmail({
      to: delivery.recipients,
      subject: "[Ankora] התראת בנק שעות (ניסיון חוזר)",
      text: `ניסיון שליחה חוזר עבור עדכון התראה קודם שנכשל (${delivery.template}).`,
    });

    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: result.ok ? "SENT" : "FAILED",
        providerMessageId: result.ok ? result.providerMessageId ?? delivery.providerMessageId : delivery.providerMessageId,
        error: result.ok ? null : result.error ?? delivery.error,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    if (result.ok) nowSent += 1;
  }

  return { retried: failed.length, nowSent };
}

/// Manually retries one specific FAILED EmailDelivery row - powers the
/// "retry" button on the Alerts admin screen (spec 12's admin screens
/// table doesn't itemize this, but 9.2's delivery-status requirement
/// implies an operator needs some way to act on a failure without
/// waiting for the once-daily cron).
export async function retryEmailDelivery(actor: User, deliveryId: string) {
  assertCan(actor.role, "alert.manage");

  const delivery = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  if (delivery.status !== "FAILED") {
    throw new Error("רק שליחות שנכשלו ניתנות לניסיון חוזר.");
  }

  const result = await sendEmail({
    to: delivery.recipients,
    subject: "[Ankora] התראת בנק שעות (ניסיון חוזר)",
    text: `ניסיון שליחה חוזר עבור עדכון התראה קודם שנכשל (${delivery.template}).`,
  });

  const updated = await prisma.emailDelivery.update({
    where: { id: deliveryId },
    data: {
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.ok ? result.providerMessageId ?? delivery.providerMessageId : delivery.providerMessageId,
      error: result.ok ? null : result.error ?? delivery.error,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "email_delivery.retry",
    entityType: "EmailDelivery",
    entityId: deliveryId,
    before: delivery,
    after: updated,
  });

  return updated;
}

/// Re-evaluates alert rules for every client that has an OPEN hour bank.
/// Powers the daily reconciliation cron (spec 9.2's "scheduled
/// reconciliation", Task #146).
export async function reconcileAllClientAlerts(): Promise<{ clientsEvaluated: number }> {
  const openBanks = await prisma.hourBank.findMany({
    where: { status: "OPEN", deletedAt: null },
    select: { clientId: true },
    distinct: ["clientId"],
  });

  for (const { clientId } of openBanks) {
    await evaluateAlertsForClient(clientId).catch((err) =>
      console.error(`Alert reconciliation failed for client ${clientId}:`, err)
    );
  }

  return { clientsEvaluated: openBanks.length };
}
