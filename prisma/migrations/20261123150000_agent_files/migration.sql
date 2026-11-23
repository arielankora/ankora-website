-- Agents (23.11.2026): text files attached to an agent version (scripts,
-- templates, references), frozen with the version like its blocks.

-- AlterTable
ALTER TABLE "agent_versions" ADD COLUMN "files" JSONB NOT NULL DEFAULT '[]';
