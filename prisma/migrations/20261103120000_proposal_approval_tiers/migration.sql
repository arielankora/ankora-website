-- 3.11.2026: approval tiers for knowledge proposals. Whether the server
-- approved a proposal on its own, and when its item was taken out again.
ALTER TABLE "knowledge_proposals" ADD COLUMN "autoApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "knowledge_proposals" ADD COLUMN "revertedAt" TIMESTAMP(3);
ALTER TABLE "knowledge_proposals" ADD COLUMN "revertedById" TEXT;
