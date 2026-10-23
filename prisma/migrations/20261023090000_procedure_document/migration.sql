-- The procedure as a document (23.10.2026): SOC 2 style fields on the
-- process, the approved document frozen on its version, and an English
-- translation a manager approves.
CREATE TYPE "ProcedureClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL');

ALTER TABLE "processes" ADD COLUMN "scope" TEXT;
ALTER TABLE "processes" ADD COLUMN "definitions" TEXT;
ALTER TABLE "processes" ADD COLUMN "controlRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "processes" ADD COLUMN "classification" "ProcedureClassification" NOT NULL DEFAULT 'CONFIDENTIAL';
ALTER TABLE "processes" ADD COLUMN "relatedDocs" TEXT;

ALTER TABLE "process_versions" ADD COLUMN "document" JSONB;
ALTER TABLE "process_versions" ADD COLUMN "translationEn" JSONB;
ALTER TABLE "process_versions" ADD COLUMN "translationEnById" TEXT;
ALTER TABLE "process_versions" ADD COLUMN "translationEnAt" TIMESTAMP(3);
ALTER TABLE "process_versions" ADD COLUMN "translationEnApprovedById" TEXT;
ALTER TABLE "process_versions" ADD COLUMN "translationEnApprovedAt" TIMESTAMP(3);
