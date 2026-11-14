-- 13.11.2026 (processes redesign, stage 2): a process that runs, or a work
-- instruction. Every existing process stays a process; the nine of
-- Ankora's own file move only after Ariel approves the list.
CREATE TYPE "ProcessKind" AS ENUM ('PROCESS', 'GUIDE');

ALTER TABLE "processes" ADD COLUMN "kind" "ProcessKind" NOT NULL DEFAULT 'PROCESS';
