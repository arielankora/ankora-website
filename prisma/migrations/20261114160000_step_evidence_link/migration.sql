-- Processes redesign, spec 4.5 (Ariel, 14.11.2026): a link to the evidence
-- that a run's step was done, for a client with audit requirements.
ALTER TABLE "tasks" ADD COLUMN "evidenceLink" TEXT;
