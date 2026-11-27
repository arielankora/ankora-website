-- Stage 2 of "התיבות שלי" (27.11.2026): a task waits for a reply to an email,
-- and the emails an owner sent are kept 14 days so one can be picked.

-- CreateEnum
CREATE TYPE "MailWaitVia" AS ENUM ('MANUAL', 'CLAUDE');

-- CreateEnum
CREATE TYPE "MailWaitEnd" AS ENUM ('REPLY', 'STOPPED', 'REPLACED');

-- AlterTable
ALTER TABLE "mail_threads" ADD COLUMN     "keepUntil" TIMESTAMP(3),
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "lastSentTo" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "task_mail_waits" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "threadId" TEXT,
    "channelId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "sentTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL,
    "lastEmailId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "via" "MailWaitVia" NOT NULL DEFAULT 'MANUAL',
    "remindAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "replyAt" TIMESTAMP(3),
    "replyFrom" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedHow" "MailWaitEnd",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_mail_waits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_mail_waits_taskId_idx" ON "task_mail_waits"("taskId");

-- CreateIndex
CREATE INDEX "task_mail_waits_channelId_externalThreadId_idx" ON "task_mail_waits"("channelId", "externalThreadId");

-- CreateIndex
CREATE INDEX "task_mail_waits_endedAt_remindAt_idx" ON "task_mail_waits"("endedAt", "remindAt");

-- AddForeignKey
ALTER TABLE "task_mail_waits" ADD CONSTRAINT "task_mail_waits_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_mail_waits" ADD CONSTRAINT "task_mail_waits_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "mail_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_mail_waits" ADD CONSTRAINT "task_mail_waits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

