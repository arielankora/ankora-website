-- Agents, phase 3 (23.11.2026): the shared block library and lessons from runs.

-- CreateEnum
CREATE TYPE "AgentLessonStatus" AS ENUM ('OPEN', 'USED', 'DISMISSED');

-- CreateTable
CREATE TABLE "shared_blocks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_block_versions" (
    "id" TEXT NOT NULL,
    "sharedBlockId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "AgentVersionState" NOT NULL DEFAULT 'PENDING',
    "body" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "shared_block_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_lessons" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "installationId" TEXT,
    "blockKey" TEXT,
    "text" TEXT NOT NULL,
    "status" "AgentLessonStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "agent_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_blocks_key_key" ON "shared_blocks"("key");

-- CreateIndex
CREATE INDEX "shared_block_versions_state_idx" ON "shared_block_versions"("state");

-- CreateIndex
CREATE UNIQUE INDEX "shared_block_versions_sharedBlockId_version_key" ON "shared_block_versions"("sharedBlockId", "version");

-- CreateIndex
CREATE INDEX "agent_lessons_agentId_status_idx" ON "agent_lessons"("agentId", "status");

-- AddForeignKey
ALTER TABLE "shared_block_versions" ADD CONSTRAINT "shared_block_versions_sharedBlockId_fkey" FOREIGN KEY ("sharedBlockId") REFERENCES "shared_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_lessons" ADD CONSTRAINT "agent_lessons_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

