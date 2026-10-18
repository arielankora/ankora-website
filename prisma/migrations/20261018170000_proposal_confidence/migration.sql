-- Spec 5.2: how sure Claude is of a proposal, to order the review card.
ALTER TABLE "knowledge_proposals" ADD COLUMN "confidence" TEXT;
