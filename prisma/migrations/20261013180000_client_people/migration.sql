-- 13.10.2026: the client file's people and organizations (org-brain
-- spec 3.1 and 3.5, decisions 2 and 8). New tables only; nothing existing
-- changes.
CREATE TYPE "KnowledgeStatus" AS ENUM ('CONFIRMED', 'UNCERTAIN', 'MISSING', 'SUPERSEDED');
CREATE TYPE "KnowledgeAudience" AS ENUM ('ALL_STAFF', 'ACCOUNT_TEAM', 'RESTRICTED');
CREATE TYPE "KnowledgeSensitivity" AS ENUM ('NORMAL', 'SENSITIVE');
CREATE TYPE "KnowledgeImportance" AS ENUM ('NORMAL', 'LOW');
CREATE TYPE "ContactRelationship" AS ENUM ('CLIENT_STAFF', 'PROVIDER', 'ADVISOR', 'INVESTOR', 'SUPPLIER', 'ANKORA');

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT,
    "relationship" "ContactRelationship" NOT NULL DEFAULT 'CLIENT_STAFF',
    "entityLabel" TEXT,
    "context" TEXT,
    "channelOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "clientSideAddress" TEXT,
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
    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_organizations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT,
    "relationship" "ContactRelationship" NOT NULL DEFAULT 'PROVIDER',
    "monthlyCostMinor" INTEGER,
    "currency" TEXT,
    "notes" TEXT,
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
    CONSTRAINT "client_organizations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organizations_name_idx" ON "organizations"("name");
CREATE INDEX "organizations_domains_idx" ON "organizations" USING GIN ("domains");
CREATE INDEX "persons_emails_idx" ON "persons" USING GIN ("emails");
CREATE INDEX "persons_phones_idx" ON "persons" USING GIN ("phones");
CREATE UNIQUE INDEX "client_contacts_clientId_personId_key" ON "client_contacts"("clientId", "personId");
CREATE INDEX "client_contacts_clientId_deletedAt_idx" ON "client_contacts"("clientId", "deletedAt");
CREATE UNIQUE INDEX "client_organizations_clientId_organizationId_key" ON "client_organizations"("clientId", "organizationId");
CREATE INDEX "client_organizations_clientId_deletedAt_idx" ON "client_organizations"("clientId", "deletedAt");

ALTER TABLE "persons" ADD CONSTRAINT "persons_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_organizations" ADD CONSTRAINT "client_organizations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_organizations" ADD CONSTRAINT "client_organizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
