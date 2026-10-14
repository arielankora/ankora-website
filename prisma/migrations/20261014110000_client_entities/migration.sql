-- 14.10.2026: the client's legal entities (org-brain spec 3.3). Contacts
-- and systems point at an entity instead of naming it in words. The
-- dropped columns were added a day earlier, in the same unreleased
-- series, and hold nothing.
CREATE TABLE "client_entities" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "country" TEXT,
    "currency" TEXT,
    "billingAddress" TEXT,
    "parentId" TEXT,
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
    CONSTRAINT "client_entities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_entities_clientId_deletedAt_idx" ON "client_entities"("clientId", "deletedAt");
ALTER TABLE "client_entities" ADD CONSTRAINT "client_entities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_entities" ADD CONSTRAINT "client_entities_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "client_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "client_contacts" DROP COLUMN "entityLabel";
ALTER TABLE "client_contacts" ADD COLUMN "entityId" TEXT;
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "client_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "system_access" DROP COLUMN "entityLabel";
ALTER TABLE "system_access" ADD COLUMN "entityId" TEXT;
ALTER TABLE "system_access" ADD CONSTRAINT "system_access_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "client_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
