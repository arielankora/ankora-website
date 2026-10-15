-- 15.10.2026: the client's own rules (org-brain spec 3.11). A new table,
-- two new enums, and a new proposal target.
CREATE TYPE "PolicyKind" AS ENUM ('DATA_HANDLING', 'DISCLOSURE', 'COMMUNICATION', 'SEPARATION', 'APPROVAL_REQUIRED', 'THRESHOLD', 'REQUIRED_STEP', 'TIMING', 'FORBIDDEN', 'INFO');
CREATE TYPE "PolicyStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'RETIRED');
ALTER TYPE "ProposalTarget" ADD VALUE 'POLICY';

CREATE TABLE "client_policies" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "PolicyKind" NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'PROPOSED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "rationale" TEXT,
    "interimStatement" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "retiredById" TEXT,
    "knowledgeStatus" "KnowledgeStatus" NOT NULL DEFAULT 'CONFIRMED',
    "fieldStatus" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "externalRefs" JSONB NOT NULL DEFAULT '[]',
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "toResolve" TEXT,
    "importance" "KnowledgeImportance" NOT NULL DEFAULT 'NORMAL',
    "audience" "KnowledgeAudience" NOT NULL DEFAULT 'ALL_STAFF',
    "audienceUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "doNotDisclose" TEXT,
    "sensitivity" "KnowledgeSensitivity" NOT NULL DEFAULT 'NORMAL',
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "client_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_policies_clientId_deletedAt_idx" ON "client_policies"("clientId", "deletedAt");
ALTER TABLE "client_policies" ADD CONSTRAINT "client_policies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
