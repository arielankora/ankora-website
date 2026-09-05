-- Phase 3: Billing policy + hour bank + live client snapshot.
--
-- Hand-authored for the same reason as Phase 0/1/2's migrations (see their
-- own header comments and docs/adr/0001, "Known limitations"): this
-- sandbox has no network route to Prisma's engine CDN, so `prisma migrate
-- dev` cannot run here. Verified functionally by applying directly to a
-- local Postgres instance with a raw SQL client. The first real
-- `prisma migrate dev` run anywhere with network access should detect
-- this as already applied/in sync with schema.prisma - no destructive
-- diff should be generated.

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('CEIL', 'NEAREST', 'EXACT');

-- CreateEnum
CREATE TYPE "BillingAggregationScope" AS ENUM ('PER_ENTRY', 'PER_TASK_PER_DAY', 'PER_DAY');

-- CreateEnum
CREATE TYPE "RolloverMode" AS ENUM ('NONE', 'FULL', 'CAPPED', 'MANUAL');

-- CreateEnum
CREATE TYPE "HourBankStatus" AS ENUM ('OPEN', 'CLOSED', 'RECALCULATED');

-- CreateTable
CREATE TABLE "billing_policies" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "minimumMinutes" INTEGER NOT NULL DEFAULT 0,
    "incrementMinutes" INTEGER NOT NULL DEFAULT 1,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'EXACT',
    "aggregationScope" "BillingAggregationScope" NOT NULL DEFAULT 'PER_ENTRY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hour_banks" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "cycleEnd" TIMESTAMP(3) NOT NULL,
    "purchasedMinutes" INTEGER NOT NULL,
    "rolloverInMinutes" INTEGER NOT NULL DEFAULT 0,
    "rolloverMode" "RolloverMode" NOT NULL DEFAULT 'NONE',
    "rolloverCapMinutes" INTEGER,
    "consumedMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "HourBankStatus" NOT NULL DEFAULT 'OPEN',
    "recalculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "hour_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hour_bank_adjustments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hourBankId" TEXT,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hour_bank_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_policies_clientId_key" ON "billing_policies"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "hour_banks_clientId_cycleStart_key" ON "hour_banks"("clientId", "cycleStart");

-- CreateIndex
CREATE INDEX "hour_banks_clientId_cycleStart_idx" ON "hour_banks"("clientId", "cycleStart");

-- CreateIndex
CREATE INDEX "hour_bank_adjustments_clientId_effectiveAt_idx" ON "hour_bank_adjustments"("clientId", "effectiveAt");

-- AddForeignKey
ALTER TABLE "billing_policies" ADD CONSTRAINT "billing_policies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hour_banks" ADD CONSTRAINT "hour_banks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hour_bank_adjustments" ADD CONSTRAINT "hour_bank_adjustments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hour_bank_adjustments" ADD CONSTRAINT "hour_bank_adjustments_hourBankId_fkey" FOREIGN KEY ("hourBankId") REFERENCES "hour_banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hour_bank_adjustments" ADD CONSTRAINT "hour_bank_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
