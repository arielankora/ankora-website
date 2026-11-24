-- Agents (24.11.2026): categories on the agents screen, to filter and group
-- by. A manager edits the list; an agent can be in several.

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "agent_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "agent_categories_pkey" PRIMARY KEY ("id")
);

