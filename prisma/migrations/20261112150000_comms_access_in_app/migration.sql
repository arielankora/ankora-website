-- The communications screen's access moves into the app (12.11.2026).
-- Additive only: a new enum, a column whose default keeps every existing
-- person exactly where they are today (the Vercel lists still apply), and
-- a table that is empty until someone sets a line's owner in the app.

-- CreateEnum
CREATE TYPE "CommsAccessLevel" AS ENUM ('NONE', 'OWN', 'CALLS', 'FULL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "commsAccessLevel" "CommsAccessLevel" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "comms_line_owners" (
    "line" TEXT NOT NULL,
    "userId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comms_line_owners_pkey" PRIMARY KEY ("line")
);

-- CreateIndex
CREATE INDEX "comms_line_owners_userId_idx" ON "comms_line_owners"("userId");

-- AddForeignKey
ALTER TABLE "comms_line_owners" ADD CONSTRAINT "comms_line_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
