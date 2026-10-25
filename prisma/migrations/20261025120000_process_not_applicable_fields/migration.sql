-- 25.10.2026: documentation fields marked not relevant on a process.
ALTER TABLE "processes" ADD COLUMN "notApplicableFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
