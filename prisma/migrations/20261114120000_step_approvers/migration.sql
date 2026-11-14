-- Processes redesign, stage 3 (14.11.2026): an approver for each step.
-- A contact who left (spec 4.6), and a run's step approved at the client,
-- with how it was approved (spec 4.5).
ALTER TABLE "client_contacts" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "approvalContactId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "approvalEvidence" JSONB;
