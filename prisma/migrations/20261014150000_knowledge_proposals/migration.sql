-- 14.10.2026: proposals to the client file, and their batches (org-brain
-- spec 5.1, 5.2, decision 1). New tables only.
CREATE TYPE "KnowledgeBatchVia" AS ENUM ('MCP', 'SCREEN');
CREATE TYPE "ProposalTarget" AS ENUM ('FACT', 'CONTACT', 'ORGANIZATION', 'SYSTEM');
CREATE TYPE "ProposalAction" AS ENUM ('CREATE', 'SUPERSEDE', 'CONTRADICT');
CREATE TYPE "ProposalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "knowledge_batches" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceId" TEXT,
    "via" "KnowledgeBatchVia" NOT NULL DEFAULT 'MCP',
    "note" TEXT,
    "dropped" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "knowledge_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knowledge_batches_clientId_closedAt_idx" ON "knowledge_batches"("clientId", "closedAt");
ALTER TABLE "knowledge_batches" ADD CONSTRAINT "knowledge_batches_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "knowledge_proposals" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "target" "ProposalTarget" NOT NULL,
    "action" "ProposalAction" NOT NULL DEFAULT 'CREATE',
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "quote" TEXT,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "state" "ProposalState" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knowledge_proposals_clientId_state_idx" ON "knowledge_proposals"("clientId", "state");
CREATE INDEX "knowledge_proposals_batchId_idx" ON "knowledge_proposals"("batchId");
ALTER TABLE "knowledge_proposals" ADD CONSTRAINT "knowledge_proposals_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "knowledge_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
