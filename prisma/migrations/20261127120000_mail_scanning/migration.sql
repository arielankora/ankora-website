-- "התיבות שלי" (27.11.2026): mailboxes employees connect through Unipile for
-- scanning, their "לא לקרוא" list, and the threads with clients found in
-- them (who and when, never the content).

-- CreateEnum
CREATE TYPE "MailBlockKind" AS ENUM ('ADDRESS', 'DOMAIN');

-- CreateTable
CREATE TABLE "mail_channels" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "kindChosenAt" TIMESTAMP(3),
    "extractionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "scanEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scanStartedAt" TIMESTAMP(3),
    "lastEmailAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_blocks" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "MailBlockKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "status" "CommsBlockStatus" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "mail_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_threads" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "clientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastEmailId" TEXT NOT NULL,
    "lastEmailAt" TIMESTAMP(3) NOT NULL,
    "lastFromAddress" TEXT,
    "emailCount" INTEGER NOT NULL DEFAULT 1,
    "held" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_threads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_channels_accountId_key" ON "mail_channels"("accountId");

-- CreateIndex
CREATE INDEX "mail_channels_ownerUserId_idx" ON "mail_channels"("ownerUserId");

-- CreateIndex
CREATE INDEX "mail_blocks_status_idx" ON "mail_blocks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "mail_blocks_channelId_kind_value_key" ON "mail_blocks"("channelId", "kind", "value");

-- CreateIndex
CREATE INDEX "mail_threads_lastEmailAt_idx" ON "mail_threads"("lastEmailAt");

-- CreateIndex
CREATE UNIQUE INDEX "mail_threads_channelId_externalThreadId_key" ON "mail_threads"("channelId", "externalThreadId");

-- AddForeignKey
ALTER TABLE "mail_channels" ADD CONSTRAINT "mail_channels_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_channels" ADD CONSTRAINT "mail_channels_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_blocks" ADD CONSTRAINT "mail_blocks_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "mail_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "mail_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

