-- 14.10.2026: the client file's facts (org-brain spec 3.4). New table
-- only; nothing existing changes.
CREATE TYPE "FactKind" AS ENUM ('SCOPE_IN', 'SCOPE_OUT', 'PREFERENCE', 'REQUIREMENT', 'LOCATION', 'FINANCE', 'TEMPORARY', 'ONE_OFF_DECISION', 'QUESTION', 'NOTE');
CREATE TYPE "FactTopic" AS ENUM ('COMMUNICATION', 'REPORTING', 'DOCUMENTS', 'AUTOMATION', 'ADMINS', 'PAYMENTS', 'SUPPLIERS', 'OTHER');

CREATE TABLE "client_facts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "FactKind" NOT NULL,
    "topic" "FactTopic",
    "body" TEXT NOT NULL,
    "subjectContactId" TEXT,
    "subjectOrgId" TEXT,
    "referTo" TEXT,
    "validUntil" TIMESTAMP(3),
    "validUntilEvent" TEXT,
    "closedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "assigneeId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answer" TEXT,
    "taskId" TEXT,
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
    CONSTRAINT "client_facts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_facts_clientId_kind_deletedAt_idx" ON "client_facts"("clientId", "kind", "deletedAt");
ALTER TABLE "client_facts" ADD CONSTRAINT "client_facts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
