-- New-client wizard (26.11.2026): the account manager's backup and the
-- channel the client prefers. Both optional, so existing clients are
-- untouched.

-- CreateEnum
CREATE TYPE "ClientChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "backupManagerId" TEXT,
ADD COLUMN     "preferredChannel" "ClientChannel";

-- CreateIndex
CREATE INDEX "clients_backupManagerId_idx" ON "clients"("backupManagerId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_backupManagerId_fkey" FOREIGN KEY ("backupManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A client being set up in the new-client wizard: created, not yet
-- activated (see ClientStatus.ONBOARDING).
ALTER TYPE "ClientStatus" ADD VALUE 'ONBOARDING';
