-- 13.10.2026: business days for important dates (org-brain spec, section
-- 3.10, decisions 6 and 11). Every existing date keeps its exact meaning:
-- calendar-day lead, no roll, Israeli calendar, and no weekly or
-- every-N-months recurrence until someone sets one.
ALTER TYPE "RecurrenceType" ADD VALUE 'WEEKLY';

CREATE TYPE "LeadUnit" AS ENUM ('CALENDAR_DAYS', 'BUSINESS_DAYS');
CREATE TYPE "RollConvention" AS ENUM ('NONE', 'PREVIOUS_BUSINESS_DAY', 'NEXT_BUSINESS_DAY');

ALTER TABLE "important_dates"
  ADD COLUMN "weekday" INTEGER,
  ADD COLUMN "intervalMonths" INTEGER,
  ADD COLUMN "leadUnit" "LeadUnit" NOT NULL DEFAULT 'CALENDAR_DAYS',
  ADD COLUMN "rollConvention" "RollConvention" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "businessCalendar" TEXT NOT NULL DEFAULT 'IL';
