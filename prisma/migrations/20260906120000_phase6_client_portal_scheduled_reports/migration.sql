-- Phase 6: Client portal + scheduled reports.
--
-- Hand-authored for the same reason as every prior phase's migration (see
-- their own header comments and docs/adr/0001, "Known limitations"): this
-- sandbox has no network route to Prisma's engine CDN, so `prisma migrate
-- dev` cannot run here. Verified functionally by applying directly to a
-- local Postgres instance with a raw SQL client. The first real
-- `prisma migrate dev` run anywhere with network access should detect
-- this as already applied/in sync with schema.prisma - no destructive
-- diff should be generated.

-- AlterTable: Client gets a portal display preference (default true keeps
-- existing behavior identical to "show everything" until an admin
-- explicitly opts a client out).
ALTER TABLE "clients" ADD COLUMN "portalShowEmployeeNames" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ClientReportType" AS ENUM ('MONTHLY_DETAILED', 'WEEKLY_ACTIVITY', 'HOURS_BY_CATEGORY', 'HOUR_BANK_STATUS');

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reportType" "ClientReportType" NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "recipients" TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "hour" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- AlterTable: EmailDelivery gains an optional link to the Phase 6
-- ReportRun it was sent for (alongside the existing Phase 4 alertEventId).
ALTER TABLE "email_deliveries" ADD COLUMN "reportRunId" TEXT;

-- CreateIndex
CREATE INDEX "report_schedules_clientId_enabled_idx" ON "report_schedules"("clientId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_scheduleId_periodStart_key" ON "report_runs"("scheduleId", "periodStart");

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_reportRunId_fkey" FOREIGN KEY ("reportRunId") REFERENCES "report_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
