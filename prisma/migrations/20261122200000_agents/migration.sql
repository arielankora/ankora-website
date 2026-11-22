-- Agents, phase 1 (22.11.2026): agents, their versions, client values
-- and installations. See prisma/schema.prisma, "Agents (סוכנים)".

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('CLIENT_PROJECT', 'SCHEDULED', 'SKILL');

-- CreateEnum
CREATE TYPE "AgentVersionState" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgentActionLevel" AS ENUM ('READ', 'DRAFT', 'SEND');

-- CreateEnum
CREATE TYPE "AgentSurface" AS ENUM ('PROJECT', 'SCHEDULED', 'PERSISTENT_SESSION', 'SKILL');

-- CreateEnum
CREATE TYPE "AgentClientScope" AS ENUM ('ONE', 'LIST', 'ALL_MINE');

-- CreateEnum
CREATE TYPE "AgentUpdateCheck" AS ENUM ('RUN', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "AgentInstallationStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "AgentVersionState" NOT NULL DEFAULT 'DRAFT',
    "actionLevel" "AgentActionLevel" NOT NULL DEFAULT 'READ',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "params" JSONB NOT NULL DEFAULT '[]',
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_client_values" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_client_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_installations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surface" "AgentSurface" NOT NULL,
    "claudeAccount" TEXT,
    "clientScope" "AgentClientScope" NOT NULL DEFAULT 'ONE',
    "clientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedules" JSONB NOT NULL DEFAULT '[]',
    "values" JSONB NOT NULL DEFAULT '{}',
    "pinnedVersionId" TEXT NOT NULL,
    "checkEvery" "AgentUpdateCheck" NOT NULL DEFAULT 'DAILY',
    "lastCheckedAt" TIMESTAMP(3),
    "pendingVersion" INTEGER,
    "lastFetchedAt" TIMESTAMP(3),
    "status" "AgentInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");

-- CreateIndex
CREATE INDEX "agent_versions_state_idx" ON "agent_versions"("state");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agentId_version_key" ON "agent_versions"("agentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "agent_client_values_agentId_clientId_key_key" ON "agent_client_values"("agentId", "clientId", "key");

-- CreateIndex
CREATE INDEX "agent_installations_userId_status_idx" ON "agent_installations"("userId", "status");

-- CreateIndex
CREATE INDEX "agent_installations_agentId_status_idx" ON "agent_installations"("agentId", "status");

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_client_values" ADD CONSTRAINT "agent_client_values_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_client_values" ADD CONSTRAINT "agent_client_values_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_installations" ADD CONSTRAINT "agent_installations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

