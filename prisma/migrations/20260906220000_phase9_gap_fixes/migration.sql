-- Phase 9: gap-fix pass following a full spec re-audit (docs/adr/0001
-- section 17). Hand-authored for the same reason as every prior phase's
-- migration (see their own header comments): this sandbox has no network
-- route to Prisma's engine CDN, so `prisma migrate dev` cannot run here.
-- Verified functionally against a local Postgres instance with a raw SQL
-- client. The first real `prisma migrate dev` run anywhere with network
-- access should detect this as already applied/in sync with schema.prisma.

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'ARCHIVED');

-- AlterTable: Task gets a status column (spec 5 + 10.2), default OPEN so
-- every existing row (all of which predate this column) lands in the same
-- state the app already implicitly assumed.
ALTER TABLE "tasks" ADD COLUMN "status" "TaskStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_type_entityId_idx" ON "notifications"("type", "entityId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
