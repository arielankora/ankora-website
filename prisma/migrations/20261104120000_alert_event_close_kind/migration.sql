-- How a closed alert event was closed, and why (4.11.2026).
--
-- Until now one column, resolvedAt, meant both "a person pressed סימון
-- כטופל" and "the system decided it no longer applies", so the history
-- could not say which, and nothing closed the events of a cycle that had
-- been replaced. See lib/app-domain/alert-closure.ts.
--
-- Additive only: existing rows keep closeKind NULL (shown as "נפתר"), and
-- the open/closed meaning of resolvedAt is unchanged, so the partial
-- unique index alert_events_one_open_per_rule_bank still holds.

-- CreateEnum
CREATE TYPE "AlertCloseKind" AS ENUM ('MANUAL', 'BELOW_THRESHOLD', 'NEW_CYCLE', 'HOURS_LOADED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "alert_events" ADD COLUMN "closeKind" "AlertCloseKind",
ADD COLUMN "closeReason" TEXT;

-- CreateIndex
CREATE INDEX "alert_events_hourBankId_idx" ON "alert_events"("hourBankId");
