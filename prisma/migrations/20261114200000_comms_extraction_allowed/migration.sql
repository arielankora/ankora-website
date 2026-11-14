-- The automatic extraction account reads a number's conversations even when
-- people are kept out of it (14.11.2026). On by default; a manager turns it off.
ALTER TABLE "comms_channels" ADD COLUMN "extractionAllowed" BOOLEAN NOT NULL DEFAULT true;
