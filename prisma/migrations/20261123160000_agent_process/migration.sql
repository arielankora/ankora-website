-- Agents (23.11.2026): an agent can carry out an Ankora process. get_agent
-- adds the approved procedure's steps at fetch time.

-- AlterTable
ALTER TABLE "agents" ADD COLUMN "processId" TEXT;

-- CreateIndex
CREATE INDEX "agents_processId_idx" ON "agents"("processId");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
