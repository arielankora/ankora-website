-- 31.10.2026: the stranger test. Claude walks a procedure as someone who
-- has never run it, and records where they would get stuck, as questions.
-- Answers go into the client's file directly.
CREATE TYPE "StrangerSeverity" AS ENUM ('BLOCKER', 'SLOWS', 'IMPROVES');
CREATE TYPE "StrangerAskWho" AS ENUM ('ANKORA', 'CLIENT');
CREATE TYPE "StrangerQuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'NOT_RELEVANT', 'REPLACED');

CREATE TABLE "process_stranger_tests" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER,
    "summary" TEXT,
    "ranById" TEXT,
    "sourceCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_stranger_tests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_stranger_questions" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "step" INTEGER,
    "severity" "StrangerSeverity" NOT NULL,
    "askWho" "StrangerAskWho" NOT NULL,
    "question" TEXT NOT NULL,
    "status" "StrangerQuestionStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "factId" TEXT,
    "policyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_stranger_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "process_stranger_tests_processId_createdAt_idx" ON "process_stranger_tests"("processId", "createdAt");
CREATE INDEX "process_stranger_questions_processId_status_idx" ON "process_stranger_questions"("processId", "status");
CREATE INDEX "process_stranger_questions_testId_idx" ON "process_stranger_questions"("testId");

ALTER TABLE "process_stranger_tests" ADD CONSTRAINT "process_stranger_tests_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_stranger_questions" ADD CONSTRAINT "process_stranger_questions_testId_fkey" FOREIGN KEY ("testId") REFERENCES "process_stranger_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
