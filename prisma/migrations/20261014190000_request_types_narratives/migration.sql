-- 14.10.2026: request types and the file's free text (org-brain spec 3.3
-- and 3.7). New tables only.
CREATE TYPE "NarrativeKind" AS ENUM ('OVERVIEW', 'BACKGROUND', 'OUR_ROLE');

CREATE TABLE "request_types" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fromWho" TEXT,
    "arrivesVia" TEXT,
    "handling" TEXT NOT NULL,
    "routeToContactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityId" TEXT,
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
    CONSTRAINT "request_types_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "request_types_clientId_deletedAt_idx" ON "request_types"("clientId", "deletedAt");
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "client_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "client_narratives" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "NarrativeKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_narratives_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_narratives_clientId_kind_version_key" ON "client_narratives"("clientId", "kind", "version");
ALTER TABLE "client_narratives" ADD CONSTRAINT "client_narratives_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
