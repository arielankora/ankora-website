-- 13.10.2026: approximate, unknown, conditional and bounded dates
-- (org-brain spec, section 3.10). Every existing date stays exact,
-- unconditional and unbounded.
CREATE TYPE "DatePrecision" AS ENUM ('EXACT', 'APPROXIMATE', 'UNKNOWN');

ALTER TABLE "important_dates"
  ADD COLUMN "precision" "DatePrecision" NOT NULL DEFAULT 'EXACT',
  ADD COLUMN "dayAlternatives" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "conditionText" TEXT,
  ADD COLUMN "rangeStart" TIMESTAMP(3),
  ADD COLUMN "rangeEnd" TIMESTAMP(3);
