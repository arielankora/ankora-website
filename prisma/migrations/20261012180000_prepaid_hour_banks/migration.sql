-- 12.10.2026: prepaid hour packages (RIMED). Every existing bank stays a
-- CYCLE; nothing existing changes meaning.
CREATE TYPE "HourBankKind" AS ENUM ('CYCLE', 'PREPAID');

ALTER TABLE "hour_banks" ADD COLUMN "kind" "HourBankKind" NOT NULL DEFAULT 'CYCLE';
