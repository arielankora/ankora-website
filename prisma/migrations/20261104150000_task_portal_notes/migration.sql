-- Lines the client reads under a visible task on their portal (4.11.2026).
-- See TaskPortalNote in schema.prisma and lib/app-domain/task-portal-notes.ts.
--
-- Additive only: a new table, nothing existing changes.

-- CreateTable
CREATE TABLE "task_portal_notes" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "task_portal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_portal_notes_taskId_createdAt_idx" ON "task_portal_notes"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "task_portal_notes" ADD CONSTRAINT "task_portal_notes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
