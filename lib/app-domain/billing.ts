import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import type { User, BillingPolicy, RoundingMode, BillingAggregationScope } from "@prisma/client";

// Phase 3 domain service: spec section 7 ("Actual Time לעומת Billable
// Time") + 7.1 ("Billing Policy"). This file owns the ONLY logic that may
// turn a TimeEntry's actualSeconds into a billableSeconds figure -
// lib/app-domain/time-entries.ts calls into here rather than duplicating
// the rounding rules, so there is exactly one place that can diverge from
// spec 7.1's table.

type PolicyLike = Pick<
  BillingPolicy,
  "minimumMinutes" | "incrementMinutes" | "roundingMode" | "aggregationScope"
>;

/// Spec 7.1's row values are examples ("15 minutes", "1/5/15 minutes"),
/// not a mandated default - the spec explicitly warns against hard-coding
/// "Ankora's actual policy" and instead requires it be configurable per
/// client (7.1: "Client override: כן"). The default for a client with NO
/// BillingPolicy row is therefore the NEUTRAL policy - zero minimum, a
/// 1-minute increment, EXACT rounding - which makes applyBillingPolicy a
/// pure no-op (billable === actual). This is the backward-compatibility
/// guarantee: introducing Phase 3 must not silently change any existing
/// client's numbers unless an admin explicitly configures a policy.
export const DEFAULT_POLICY: PolicyLike = {
  minimumMinutes: 0,
  incrementMinutes: 1,
  roundingMode: "EXACT",
  aggregationScope: "PER_ENTRY",
};

export async function getBillingPolicy(clientId: string): Promise<BillingPolicy | null> {
  return prisma.billingPolicy.findUnique({ where: { clientId } });
}

/// Spec 7.1: minimum-per-entry floor, then round to the nearest
/// increment per roundingMode. Pure function, seconds in/seconds out, so
/// it is trivially unit-testable without a database. EXACT means "no
/// increment rounding at all" - the minimum floor still applies, but the
/// increment is ignored (an EXACT policy with a >1 increment is a
/// contradictory configuration the UI should discourage, but this
/// function still behaves predictably for it: minimum only).
export function applyBillingPolicy(actualSeconds: number, policy?: PolicyLike | null): number {
  if (!Number.isFinite(actualSeconds) || actualSeconds <= 0) return 0;

  const p = policy ?? DEFAULT_POLICY;
  const minimumSeconds = Math.max(0, p.minimumMinutes) * 60;
  const flooredSeconds = Math.max(actualSeconds, minimumSeconds);

  const incrementSeconds = Math.max(1, p.incrementMinutes) * 60;
  switch (p.roundingMode) {
    case "CEIL":
      return Math.ceil(flooredSeconds / incrementSeconds) * incrementSeconds;
    case "NEAREST":
      return Math.round(flooredSeconds / incrementSeconds) * incrementSeconds;
    case "EXACT":
    default:
      return Math.round(flooredSeconds);
  }
}

/// Convenience used by time-entries.ts at create/stop/edit time: looks up
/// the client's policy (if any) and applies it to a single entry's own
/// actualSeconds. This is always computed per-entry regardless of
/// aggregationScope - see computeConsumedMinutesForRange's doc comment
/// below for why per-task/per-day aggregation is handled separately at
/// the Hour Bank consumption layer rather than by mutating individual
/// entries' billableSeconds.
export async function computeEntryBillableSeconds(clientId: string, actualSeconds: number): Promise<number> {
  const policy = await getBillingPolicy(clientId);
  return applyBillingPolicy(actualSeconds, policy);
}

/// Spec 7.1's "Aggregation scope: per entry / per task per day / per
/// day" describes at what granularity the minimum/rounding rules apply
/// for BILLING purposes, not necessarily what each entry displays.
/// Rounding a GROUP's total and then splitting it back across N sibling
/// entries has no well-defined answer (the spec never specifies a split
/// rule), so this engagement's chosen interpretation - documented in
/// docs/adr/0001's Phase 3 addendum - is: every TimeEntry always keeps
/// its own true per-entry billableSeconds (via computeEntryBillableSeconds
/// above) for transparency in reports and revision history, while Hour
/// Bank CONSUMPTION - the actual number that matters for spec 8's "בנק
/// שעות" - is computed at read time by this function, grouping raw
/// actualSeconds per spec's aggregation scope before applying the
/// minimum/rounding once per group. PER_ENTRY scope (the default) is
/// simply the sum of each entry's own billableSeconds, unchanged from
/// Phase 2 behavior.
export async function computeConsumedMinutesForRange(
  clientId: string,
  range: { from: Date; to: Date }
): Promise<number> {
  const policy = await getBillingPolicy(clientId);
  const scope: BillingAggregationScope = policy?.aggregationScope ?? "PER_ENTRY";

  const entries = await prisma.timeEntry.findMany({
    where: {
      clientId,
      deletedAt: null,
      startAt: { gte: range.from, lt: range.to },
      endAt: { not: null }, // an active timer has no actualSeconds yet
    },
    select: { actualSeconds: true, billableSeconds: true, taskId: true, startAt: true },
  });

  if (scope === "PER_ENTRY") {
    const totalSeconds = entries.reduce((sum, e) => sum + (e.billableSeconds ?? 0), 0);
    return Math.round(totalSeconds / 60);
  }

  // PER_DAY / PER_TASK_PER_DAY: group raw actualSeconds, then apply the
  // policy once per group.
  const groups = new Map<string, number>();
  for (const e of entries) {
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(e.startAt);
    const key = scope === "PER_TASK_PER_DAY" ? `${e.taskId ?? "no-task"}:${dayKey}` : dayKey;
    groups.set(key, (groups.get(key) ?? 0) + (e.actualSeconds ?? 0));
  }

  let totalSeconds = 0;
  for (const groupActualSeconds of groups.values()) {
    totalSeconds += applyBillingPolicy(groupActualSeconds, policy);
  }
  return Math.round(totalSeconds / 60);
}

// ---------------------------------------------------------------------
// BillingPolicy CRUD (spec 7.1: "Client override: כן")
// ---------------------------------------------------------------------

export async function upsertBillingPolicy(
  actor: User,
  clientId: string,
  input: {
    minimumMinutes: number;
    incrementMinutes: number;
    roundingMode: RoundingMode;
    aggregationScope: BillingAggregationScope;
  }
) {
  assertCan(actor.role, "hour_bank.manage");

  const before = await prisma.billingPolicy.findUnique({ where: { clientId } });
  const policy = await prisma.billingPolicy.upsert({
    where: { clientId },
    create: {
      clientId,
      minimumMinutes: Math.max(0, Math.round(input.minimumMinutes)),
      incrementMinutes: Math.max(1, Math.round(input.incrementMinutes)),
      roundingMode: input.roundingMode,
      aggregationScope: input.aggregationScope,
    },
    update: {
      minimumMinutes: Math.max(0, Math.round(input.minimumMinutes)),
      incrementMinutes: Math.max(1, Math.round(input.incrementMinutes)),
      roundingMode: input.roundingMode,
      aggregationScope: input.aggregationScope,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: before ? "billing_policy.update" : "billing_policy.create",
    entityType: "BillingPolicy",
    entityId: policy.id,
    clientId,
    before,
    after: policy,
  });

  return policy;
}
