-- Spec 3.9: what the client's rules said about a procedure when it was approved.
ALTER TABLE "process_versions" ADD COLUMN "approvalChecks" JSONB;

-- Spec 3.9: the permission each required system needs, and who does the
-- process today when it is a person in the file.
ALTER TABLE "processes" ADD COLUMN "requiredSystemPermissions" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "processes" ADD COLUMN "executorUserId" TEXT;
ALTER TABLE "processes" ADD COLUMN "executorContactId" TEXT;
