-- 7.10.2026: a retried email resends what failed, not a stub.
--
-- Until now a FAILED email_deliveries row kept only its recipients and a
-- template name, so both retry paths (the daily cron and the button on
-- the Alerts screen) mailed a fixed "[Ankora] התראת בנק שעות (ניסיון חוזר)"
-- line instead. A client whose weekly report failed to send received a
-- confusing "hour bank alert" and never the report. Both columns are
-- nullable: rows written before this migration have neither, and a
-- report row is rebuilt from its ReportRun snapshot instead.
ALTER TABLE "email_deliveries" ADD COLUMN "subject" TEXT;
ALTER TABLE "email_deliveries" ADD COLUMN "body" TEXT;
