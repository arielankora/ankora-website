-- Phase 8: Integration foundation validation + production rollout.
--
-- Hand-authored for the same reason as every prior phase's migration (see
-- their own header comments and docs/adr/0001, "Known limitations"): this
-- sandbox has no network route to Prisma's engine CDN, so `prisma migrate
-- dev` cannot run here. Verified functionally by applying directly to a
-- local Postgres instance with a raw SQL client. The first real
-- `prisma migrate dev` run anywhere with network access should detect
-- this as already applied/in sync with schema.prisma - no destructive
-- diff should be generated.

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "credentialsRef" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_mappings" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "internalEntityType" TEXT NOT NULL,
    "internalEntityId" TEXT NOT NULL,
    "externalEntityType" TEXT NOT NULL,
    "externalEntityId" TEXT NOT NULL,
    "syncMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_provider_key" ON "integration_connections"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "external_mappings_provider_internalEntityType_internalEnti_key" ON "external_mappings"("provider", "internalEntityType", "internalEntityId");

-- CreateIndex
CREATE INDEX "external_mappings_provider_externalEntityType_externalEnti_idx" ON "external_mappings"("provider", "externalEntityType", "externalEntityId");

-- AddForeignKey
ALTER TABLE "external_mappings" ADD CONSTRAINT "external_mappings_provider_fkey" FOREIGN KEY ("provider") REFERENCES "integration_connections"("provider") ON DELETE CASCADE ON UPDATE CASCADE;
