-- Spec 5.1, step 3: a batch waiting for a person to say which client it belongs to.
ALTER TABLE "knowledge_batches" ADD COLUMN "awaitingAssignment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "knowledge_batches" ADD COLUMN "candidateClientIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "knowledge_batches" ADD COLUMN "assignmentReason" TEXT;
ALTER TABLE "knowledge_batches" ADD COLUMN "pendingInput" JSONB;

CREATE INDEX "knowledge_batches_awaitingAssignment_idx" ON "knowledge_batches"("awaitingAssignment");
