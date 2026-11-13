-- The rest of what WhatsApp shows (13.11.2026): calls and group events as
-- lines, reactions, mentions, view-once and disappearing marks, a business
-- message's buttons; on files, whether they are gone, stickers and GIFs,
-- and a contact card's emails and organization. Additive only.

-- AlterTable
ALTER TABLE "comms_messages" ADD COLUMN "eventType" INTEGER,
ADD COLUMN "eventData" JSONB,
ADD COLUMN "reactions" JSONB,
ADD COLUMN "mentions" JSONB,
ADD COLUMN "viewOnce" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "disappearing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "buttons" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "comms_attachments" ADD COLUMN "contactEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "contactOrg" TEXT,
ADD COLUMN "unavailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sticker" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "gif" BOOLEAN NOT NULL DEFAULT false;
