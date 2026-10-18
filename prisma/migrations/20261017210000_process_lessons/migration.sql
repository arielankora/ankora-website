-- Org brain (spec 5.4): what the person who closed a run says about the
-- procedure it followed. One answer per run.
CREATE TYPE "ProcessLessonStatus" AS ENUM ('NOTHING', 'OPEN', 'APPLIED', 'DISMISSED');

CREATE TABLE "process_lessons" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "version" INTEGER,
    "status" "ProcessLessonStatus" NOT NULL,
    "body" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "process_lessons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "process_lessons_taskId_key" ON "process_lessons"("taskId");
CREATE INDEX "process_lessons_processId_status_idx" ON "process_lessons"("processId", "status");

ALTER TABLE "process_lessons" ADD CONSTRAINT "process_lessons_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
