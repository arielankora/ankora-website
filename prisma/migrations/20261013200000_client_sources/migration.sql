-- 13.10.2026: the client file's source register and domains (org-brain
-- spec 3.2 and 3.5). New tables only; nothing existing changes.
CREATE TYPE "SourceKind" AS ENUM ('TRANSCRIPT', 'CLIENT_DOCUMENT', 'TASK', 'PERSON', 'ANKORA_DOCUMENT');
CREATE TYPE "SourceWeight" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "SourceRestriction" AS ENUM ('NONE', 'TOPICS_ONLY');
CREATE TYPE "ClientDomainKind" AS ENUM ('CLIENT', 'PARTNER');

CREATE TABLE "client_sources" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "weight" "SourceWeight" NOT NULL DEFAULT 'PRIMARY',
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "externalRefs" JSONB NOT NULL DEFAULT '[]',
    "restriction" "SourceRestriction" NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "client_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_sources_clientId_seq_key" ON "client_sources"("clientId", "seq");
CREATE UNIQUE INDEX "client_sources_clientId_code_key" ON "client_sources"("clientId", "code");
ALTER TABLE "client_sources" ADD CONSTRAINT "client_sources_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "client_domains" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" "ClientDomainKind" NOT NULL,
    "organizationId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "client_domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_domains_clientId_domain_key" ON "client_domains"("clientId", "domain");
CREATE INDEX "client_domains_domain_idx" ON "client_domains"("domain");
ALTER TABLE "client_domains" ADD CONSTRAINT "client_domains_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_domains" ADD CONSTRAINT "client_domains_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
