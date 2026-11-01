-- 1.11.2026: communications storage, stage 3. WhatsApp conversations kept
-- for every connected number, except numbers on its block list. See the
-- comment above CommsChannel in schema.prisma.
CREATE TYPE "CommsBlockKind" AS ENUM ('PHONE', 'CHAT');
CREATE TYPE "CommsBlockStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

CREATE TABLE "comms_channels" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "excludedViewerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "storeStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "comms_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comms_conversations" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalChatId" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "otherPhone" TEXT,
    "name" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "groupClientId" TEXT,
    "backfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "comms_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comms_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "isSender" BOOLEAN NOT NULL DEFAULT false,
    "senderName" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "held" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "comms_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comms_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mimetype" TEXT,
    "voiceNote" BOOLEAN NOT NULL DEFAULT false,
    "durationSec" INTEGER,
    "fileName" TEXT,
    "driveFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comms_blocks" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "CommsBlockKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "status" "CommsBlockStatus" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "comms_blocks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "transcripts" ADD COLUMN "attachmentId" TEXT;

CREATE UNIQUE INDEX "comms_channels_accountId_key" ON "comms_channels"("accountId");
CREATE UNIQUE INDEX "comms_conversations_channelId_externalChatId_key" ON "comms_conversations"("channelId", "externalChatId");
CREATE INDEX "comms_conversations_otherPhone_idx" ON "comms_conversations"("otherPhone");
CREATE INDEX "comms_conversations_channelId_lastMessageAt_idx" ON "comms_conversations"("channelId", "lastMessageAt");
CREATE UNIQUE INDEX "comms_messages_conversationId_externalId_key" ON "comms_messages"("conversationId", "externalId");
CREATE INDEX "comms_messages_conversationId_at_idx" ON "comms_messages"("conversationId", "at");
CREATE UNIQUE INDEX "comms_attachments_messageId_externalId_key" ON "comms_attachments"("messageId", "externalId");
CREATE UNIQUE INDEX "comms_blocks_channelId_kind_value_key" ON "comms_blocks"("channelId", "kind", "value");
CREATE INDEX "comms_blocks_status_idx" ON "comms_blocks"("status");
CREATE UNIQUE INDEX "transcripts_attachmentId_key" ON "transcripts"("attachmentId");

ALTER TABLE "comms_channels" ADD CONSTRAINT "comms_channels_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comms_conversations" ADD CONSTRAINT "comms_conversations_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "comms_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comms_messages" ADD CONSTRAINT "comms_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "comms_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comms_attachments" ADD CONSTRAINT "comms_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "comms_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comms_blocks" ADD CONSTRAINT "comms_blocks_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "comms_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "comms_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
