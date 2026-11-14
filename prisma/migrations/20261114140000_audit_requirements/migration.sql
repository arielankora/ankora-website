-- Processes redesign, stage 4 (14.11.2026), spec 4.7: an audited client.
-- On for NUX and Ankora's own file (Ariel, 13.11.2026).
ALTER TABLE "clients" ADD COLUMN "auditRequirements" BOOLEAN NOT NULL DEFAULT false;
UPDATE "clients" SET "auditRequirements" = true WHERE "id" IN ('cmus2s91n0000l2042z9y4cbj', 'cmucgdw0r0000id04857t82r7');
