-- Agents, phase 2 (23.11.2026): the run log, and a faulty mark on a version.

-- CreateEnum
CREATE TYPE "AgentRunOutcome" AS ENUM ('OK', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "agent_versions" ADD COLUMN     "faultyAt" TIMESTAMP(3),
ADD COLUMN     "faultyById" TEXT,
ADD COLUMN     "faultyReason" TEXT;

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "outcome" "AgentRunOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_installationId_createdAt_idx" ON "agent_runs"("installationId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_createdAt_idx" ON "agent_runs"("createdAt");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "agent_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

