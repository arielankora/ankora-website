-- 3.11.2026: a date that falls on every business day of its calendar
-- (Sunday to Thursday in Israel, without its holidays), for a process that
-- runs every working day. Existing dates are unchanged.
ALTER TYPE "RecurrenceType" ADD VALUE 'BUSINESS_DAILY';
