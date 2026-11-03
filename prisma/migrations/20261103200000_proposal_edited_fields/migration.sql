-- 3.11.2026: which fields a person changed in a proposal before approving
-- it, names only (lib/proposal-edits.ts). The values before and after stay
-- in the audit row of the approval.
ALTER TABLE "knowledge_proposals" ADD COLUMN "editedFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
