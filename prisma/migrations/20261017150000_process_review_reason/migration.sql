-- Org brain (spec 7.3, 5.4): why a process needs review. needsReview
-- existed but nothing set it; from now the daily job and every rule change
-- do, and this says which of the two.
ALTER TABLE "processes" ADD COLUMN "reviewReason" TEXT;
