-- The language Ankora writes to a client's people who have no account in
-- the app (12.11.2026, ADR 0006, outgoing channels, part B). Additive
-- only: the default keeps every existing client on Hebrew, exactly as
-- they are written to today.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "communicationLocale" "AppLocale" NOT NULL DEFAULT 'he';
