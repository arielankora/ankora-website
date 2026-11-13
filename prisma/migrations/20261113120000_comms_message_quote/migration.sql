-- WhatsApp replies (13.11.2026, Ariel): a message that answers another one
-- keeps what it quoted, so the screen can show it and jump to the original.
-- Additive only: every existing message has no quote.

-- AlterTable
ALTER TABLE "comms_messages" ADD COLUMN "quotedExternalId" TEXT,
ADD COLUMN "quotedKind" TEXT,
ADD COLUMN "quotedSenderName" TEXT,
ADD COLUMN "quotedText" TEXT;
