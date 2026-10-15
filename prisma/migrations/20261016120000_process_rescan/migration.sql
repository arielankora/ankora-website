-- 16.10.2026: what the server checks of a client's rule, and why a
-- process needs review (org-brain spec 7.2, 7.3). Nullable or defaulted
-- columns only.
ALTER TABLE "client_policies" ADD COLUMN "checkTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "client_policies" ADD COLUMN "requiredTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "client_policies" ADD COLUMN "channels" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "client_policies" ADD COLUMN "minLeadBusinessDays" INTEGER;
ALTER TABLE "processes" ADD COLUMN "reviewFindings" JSONB NOT NULL DEFAULT '[]';
