-- Phase 4: Alerts + email delivery logs.
--
-- Hand-authored for the same reason as Phase 0/1/2/3's migrations (see
-- their own header comments and docs/adr/0001, "Known limitations"): this
-- sandbox has no network route to Prisma's engine CDN, so `prisma migrate
-- dev` cannot run here. Verified functionally by applying directly to a
-- local Postgres instance with a raw SQL client. The first real
-- `prisma migrate dev` run anywhere with network access should detect
-- this as already applied/in sync with schema.prisma - no destructive
-- diff should be generated.

-- CreateEnum
CREATE TYPE "AlertThresholdType" AS ENUM ('UTILIZATION_PCT', 'REMAINING_MINUTES', 'CONSUMED_MINUTES', 'OVERAGE');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "AlertThresholdType" NOT NULL,
    "thresholdValue" INTEGER NOT NULL DEFAULT 0,
    "recipientsAnkora" TEXT[],
    "recipientsClient" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowRetrigger" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "hourBankId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "alertEventId" TEXT,
    "template" TEXT NOT NULL,
    "recipients" TEXT[],
    "providerMessageId" TEXT,
    "status" "EmailDeliveryStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_rules_clientId_enabled_idx" ON "alert_rules"("clientId", "enabled");

-- CreateIndex
CREATE INDEX "alert_events_ruleId_hourBankId_idx" ON "alert_events"("ruleId", "hourBankId");

-- CreateIndex
CREATE INDEX "email_deliveries_status_attempts_idx" ON "email_deliveries"("status", "attempts");

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_alertEventId_fkey" FOREIGN KEY ("alertEventId") REFERENCES "alert_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
