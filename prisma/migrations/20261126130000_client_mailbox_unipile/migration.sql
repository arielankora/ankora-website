-- A client's mailbox and calendar through Unipile (26.11.2026, Ariel and
-- Hadas): a new kind of client connection, and the Unipile account it reads.

-- AlterEnum
ALTER TYPE "ConnectionKind" ADD VALUE 'UNIPILE_MAIL';

-- AlterTable
ALTER TABLE "client_connections" ADD COLUMN     "unipileAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "client_connections_unipileAccountId_key" ON "client_connections"("unipileAccountId");
