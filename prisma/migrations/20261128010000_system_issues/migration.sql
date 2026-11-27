-- CreateEnum
CREATE TYPE "SystemIssueSeverity" AS ENUM ('CRITICAL', 'WARNING');

-- CreateEnum
CREATE TYPE "SystemIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "system_issues" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "severity" "SystemIssueSeverity" NOT NULL,
    "status" "SystemIssueStatus" NOT NULL DEFAULT 'OPEN',
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAlertedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "note" TEXT,
    "prUrl" TEXT,

CONSTRAINT "system_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "summary" JSONB,
    "error" TEXT,

CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_issues_status_lastSeenAt_idx" ON "system_issues"("status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "system_issues_area_key_key" ON "system_issues"("area", "key");

-- CreateIndex
CREATE INDEX "cron_runs_job_startedAt_idx" ON "cron_runs"("job", "startedAt");
