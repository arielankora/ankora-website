-- Stage 3 of "התיבות שלי" (27.11.2026): who wrote in each thread, and up to
-- which email the knowledge extraction read it.

-- AlterTable
ALTER TABLE "mail_threads" ADD COLUMN     "extractedThroughAt" TIMESTAMP(3),
ADD COLUMN     "senders" TEXT[] DEFAULT ARRAY[]::TEXT[];

