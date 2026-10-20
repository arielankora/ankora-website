-- "כבר בתיק" on the review screen: a proposal for something already in
-- the client's file closes by adding its sources to the item there.
ALTER TABLE "knowledge_proposals" ADD COLUMN "attached" BOOLEAN NOT NULL DEFAULT false;
