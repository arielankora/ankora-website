-- Phase 10: Important Dates ("מועדים חשובים").
--
-- Hand-authored for the same reason as every prior phase's migration (see
-- their own header comments and docs/adr/0001's "Known limitations"): this
-- sandbox has no network route to Prisma's engine CDN, so `prisma migrate
-- dev` cannot run here. Written to match prisma/schema.prisma exactly and
-- verified by inspection against every prior hand-authored migration's own
-- generated style. Additive only - no existing column/table/constraint is
-- dropped or altered destructively; the first real `prisma migrate dev`
-- run anywhere with network access should detect this as already applied/
-- in sync with schema.prisma, no destructive diff should be generated.

-- CreateEnum
CREATE TYPE "ImportantDateCategory" AS ENUM ('PEOPLE_FAMILY', 'DOCUMENTS_AUTHORITIES', 'BUSINESS_FINANCE', 'VEHICLE_PROPERTY', 'HEALTH_TRAVEL', 'GENERAL');

-- CreateEnum
CREATE TYPE "CalendarType" AS ENUM ('GREGORIAN', 'HEBREW');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('ONCE', 'ANNUAL', 'MONTHLY', 'CUSTOM_INTERVAL');

-- CreateEnum
CREATE TYPE "ImportantDateStatus" AS ENUM ('ACTIVE', 'NEEDS_ATTENTION', 'IN_PROGRESS', 'HANDLED_CURRENT', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ImportantDateSensitivity" AS ENUM ('NORMAL', 'SENSITIVE');

-- CreateEnum
CREATE TYPE "ImportantDateSource" AS ENUM ('MANUAL', 'HOLIDAY', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "ReminderOccurrenceStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable: extend "tasks" (spec: assignee, due date, link back to the
-- ImportantDate/occurrence that auto-created it - all additive/nullable,
-- existing rows are unaffected).
ALTER TABLE "tasks" ADD COLUMN "assignedToId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "importantDateId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "importantDateOccurrenceKey" TEXT;

-- CreateTable
CREATE TABLE "important_dates" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "ImportantDateCategory" NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityName" TEXT,
    "relationToClient" TEXT,
    "calendarType" "CalendarType" NOT NULL DEFAULT 'GREGORIAN',
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "originYear" INTEGER,
    "recurrence" "RecurrenceType" NOT NULL DEFAULT 'ANNUAL',
    "customIntervalDays" INTEGER,
    "onceDate" TIMESTAMP(3),
    "leapDayUseMarchFirst" BOOLEAN NOT NULL DEFAULT false,
    "hebrewAdarTwoInLeapYear" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "responsibleUserId" TEXT NOT NULL,
    "additionalUserIds" TEXT[],
    "extraEmailRecipients" TEXT[],
    "status" "ImportantDateStatus" NOT NULL DEFAULT 'ACTIVE',
    "sensitivity" "ImportantDateSensitivity" NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "createAutoTask" BOOLEAN NOT NULL DEFAULT false,
    "autoTaskLeadDays" INTEGER,
    "autoTaskCategoryId" TEXT,
    "nextOccurrenceAt" TIMESTAMP(3),
    "currentOccurrenceAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "source" "ImportantDateSource" NOT NULL DEFAULT 'MANUAL',
    "holidayKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "important_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_rules" (
    "id" TEXT NOT NULL,
    "importantDateId" TEXT NOT NULL,
    "daysBefore" INTEGER NOT NULL,
    "sendInApp" BOOLEAN NOT NULL DEFAULT true,
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "extraAnkoraRecipients" TEXT[],
    "clientRecipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createTask" BOOLEAN NOT NULL DEFAULT false,
    "escalateToManager" BOOLEAN NOT NULL DEFAULT false,
    "escalateAfterDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_occurrences" (
    "id" TEXT NOT NULL,
    "importantDateId" TEXT NOT NULL,
    "reminderRuleId" TEXT,
    "occurrenceYear" INTEGER NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "recipientUserId" TEXT,
    "recipientEmail" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "attemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "status" "ReminderOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendar_subscriptions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultReminderDaysBefore" INTEGER[] DEFAULT ARRAY[30,7]::INTEGER[],
    "responsibleUserId" TEXT,
    "createTasks" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holiday_calendar_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_occurrences_idempotencyKey_key" ON "reminder_occurrences"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "important_dates_clientId_holidayKey_key" ON "important_dates"("clientId", "holidayKey");

-- CreateIndex
CREATE INDEX "important_dates_clientId_status_deletedAt_idx" ON "important_dates"("clientId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "important_dates_nextOccurrenceAt_idx" ON "important_dates"("nextOccurrenceAt");

-- CreateIndex
CREATE INDEX "important_dates_responsibleUserId_idx" ON "important_dates"("responsibleUserId");

-- CreateIndex
CREATE INDEX "reminder_rules_importantDateId_enabled_idx" ON "reminder_rules"("importantDateId", "enabled");

-- CreateIndex
CREATE INDEX "reminder_occurrences_importantDateId_occurrenceYear_idx" ON "reminder_occurrences"("importantDateId", "occurrenceYear");

-- CreateIndex
CREATE INDEX "reminder_occurrences_status_scheduledFor_idx" ON "reminder_occurrences"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendar_subscriptions_clientId_calendarKey_key" ON "holiday_calendar_subscriptions"("clientId", "calendarKey");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_importantDateId_importantDateOccurrenceKey_key" ON "tasks"("importantDateId", "importantDateOccurrenceKey");

-- CreateIndex
CREATE INDEX "tasks_assignedToId_idx" ON "tasks"("assignedToId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_importantDateId_fkey" FOREIGN KEY ("importantDateId") REFERENCES "important_dates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_autoTaskCategoryId_fkey" FOREIGN KEY ("autoTaskCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_importantDateId_fkey" FOREIGN KEY ("importantDateId") REFERENCES "important_dates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_occurrences" ADD CONSTRAINT "reminder_occurrences_importantDateId_fkey" FOREIGN KEY ("importantDateId") REFERENCES "important_dates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_occurrences" ADD CONSTRAINT "reminder_occurrences_reminderRuleId_fkey" FOREIGN KEY ("reminderRuleId") REFERENCES "reminder_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_calendar_subscriptions" ADD CONSTRAINT "holiday_calendar_subscriptions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_calendar_subscriptions" ADD CONSTRAINT "holiday_calendar_subscriptions_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
