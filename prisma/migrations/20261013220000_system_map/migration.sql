-- 13.10.2026: the client's system map (org-brain spec 3.6). New table
-- only; the vault is untouched and only referenced.
CREATE TYPE "SystemPermission" AS ENUM ('NONE', 'VIEWER', 'USER', 'BILLING', 'ADMIN', 'OWNER');
CREATE TYPE "SystemAccessStatus" AS ENUM ('HAS_ACCESS', 'PENDING', 'NO_ACCESS', 'NOT_NEEDED');
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL', 'OTHER');

CREATE TABLE "system_access" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "purpose" TEXT,
    "entityLabel" TEXT,
    "url" TEXT,
    "accountUsed" TEXT,
    "ourPermission" "SystemPermission" NOT NULL DEFAULT 'NONE',
    "accessStatus" "SystemAccessStatus" NOT NULL DEFAULT 'NO_ACCESS',
    "blocker" TEXT,
    "clientAdmin" TEXT,
    "credentialId" TEXT,
    "billingCycle" "BillingCycle",
    "billingCostMinor" INTEGER,
    "billingCurrency" TEXT,
    "cardLast4" TEXT,
    "invoiceTo" TEXT,
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
    CONSTRAINT "system_access_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "system_access_clientId_deletedAt_idx" ON "system_access"("clientId", "deletedAt");
ALTER TABLE "system_access" ADD CONSTRAINT "system_access_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "system_access" ADD CONSTRAINT "system_access_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "client_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
