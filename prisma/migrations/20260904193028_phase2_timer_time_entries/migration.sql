-- Phase 2: Timer + TimeEntry + manual entry + audit revisions (spec 23).
--
-- NOTE ON PROVENANCE: hand-authored, field-for-field from prisma/schema.prisma,
-- and verified against a local Postgres instance with a raw SQL client - see
-- prisma/migrations/20260904180031_phase1_.../migration.sql's header for the
-- full explanation of why (sandbox has no route to Prisma's engine CDN). The
-- same rule applies here: schema.prisma is the source of truth, and if Prisma
-- ever proposes a "drift" fix against this file, let it regenerate rather than
-- hand-editing this file again - EXCEPT for the partial unique index below,
-- which cannot be expressed in schema.prisma at all (see that file's Phase 2
-- header comment) and must be preserved by hand in any future migration.

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('MANUAL', 'TIMER');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'local',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "taskId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "actualSeconds" INTEGER,
    "billableSeconds" INTEGER,
    "note" TEXT,
    "source" "TimeEntrySource" NOT NULL DEFAULT 'MANUAL',
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry_revisions" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reason" TEXT,

    CONSTRAINT "time_entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_clientId_idx" ON "tasks"("clientId");

-- CreateIndex
CREATE INDEX "time_entries_userId_startAt_idx" ON "time_entries"("userId", "startAt");

-- CreateIndex
CREATE INDEX "time_entries_clientId_startAt_idx" ON "time_entries"("clientId", "startAt");

-- CreateIndex
CREATE INDEX "time_entries_categoryId_startAt_idx" ON "time_entries"("categoryId", "startAt");

-- CreateIndex
-- Spec 18.2: "concurrent start requests create max one active timer."
-- Not expressible in schema.prisma (no portable partial-unique-index DSL) -
-- see that file's Phase 2 header comment. This is the actual race-safe
-- guarantee; lib/app-domain/time-entries.ts's pre-check is a friendlier
-- error message on top of this, not a substitute for it.
CREATE UNIQUE INDEX "time_entries_one_active_per_user" ON "time_entries"("userId") WHERE "endAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "time_entry_revisions_timeEntryId_version_key" ON "time_entry_revisions"("timeEntryId", "version");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_revisions" ADD CONSTRAINT "time_entry_revisions_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_revisions" ADD CONSTRAINT "time_entry_revisions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
