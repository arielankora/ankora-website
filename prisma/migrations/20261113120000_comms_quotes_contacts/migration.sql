-- WhatsApp messages keep what they reply to, whether they were forwarded,
-- and a shared contact's name and numbers (13.11.2026). Additive only:
-- existing rows get no quote, not forwarded, and no contact.

-- AlterTable
ALTER TABLE "comms_messages" ADD COLUMN "quoted" JSONB,
ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "comms_attachments" ADD COLUMN "contactName" TEXT,
ADD COLUMN "contactPhones" TEXT[] DEFAULT ARRAY[]::TEXT[];
