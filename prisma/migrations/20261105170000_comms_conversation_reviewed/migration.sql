-- "שיחות חדשות לבדיקה" (5.11.2026): when someone decided to keep a
-- conversation that began after a number started storing. See
-- CommsConversation.reviewedAt in schema.prisma and lib/comms/new-chats.ts.
--
-- Additive only: one nullable column. Existing conversations stay as they
-- are; only those that began after storing started are offered for review.

-- AlterTable
ALTER TABLE "comms_conversations" ADD COLUMN "reviewedAt" TIMESTAMP(3);
