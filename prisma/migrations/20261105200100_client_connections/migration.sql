-- Client connections for procedures (4.11.2026, task cmvtivumj000pjs08q9qj4t67,
-- ADR 0001 section 24). Additive only: a new table and enum. The secret of
-- each connection lives in client_credentials (the vault); this table holds
-- only what a screen may show.

-- Idempotent: the prototype's preview database applied this change under an
-- earlier migration name before the branch was rebased.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ConnectionKind" AS ENUM ('GOOGLE_OAUTH', 'MAIL_APP_PASSWORD', 'MANAGER_SEND');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "client_connections" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ConnectionKind" NOT NULL,
    "account" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credentialId" TEXT,
    "ownerUserId" TEXT,
    "consentText" TEXT,
    "connectedById" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "client_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "client_connections_credentialId_key" ON "client_connections"("credentialId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "client_connections_clientId_revokedAt_idx" ON "client_connections"("clientId", "revokedAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "client_connections" ADD CONSTRAINT "client_connections_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
