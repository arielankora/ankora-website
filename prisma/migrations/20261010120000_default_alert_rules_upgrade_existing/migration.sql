-- 10.10.2026, Ariel: rules that match a default rule (utilization at 80%
-- or 100%) but were written by hand before the defaults existed get the
-- defaults' recipients too.
--
-- 20261009120000_default_alert_rules skipped any client that already had a
-- rule with the same type and threshold, so those hand-written rules kept
-- their old recipient list. On the day it shipped that was RIMED: its 80%
-- and 100% rules mailed Ariel only, while Hadas had just become its account
-- manager. This adds Ariel and Hadas where missing and turns on
-- notifyAccountManager. Anyone already on a list stays on it, client
-- recipients are not touched, and open/closed alert events are not touched.
-- Idempotent: a second run changes nothing.
UPDATE "alert_rules"
SET "recipientsAnkora" = ARRAY(
      SELECT DISTINCT e FROM unnest("recipientsAnkora" || ARRAY['ariel@ankora.co.il', 'hadas@ankora.co.il']::TEXT[]) AS e
      ORDER BY e
    ),
    "notifyAccountManager" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'UTILIZATION_PCT'
  AND "thresholdValue" IN (80, 100)
  AND (
    "notifyAccountManager" = false
    OR NOT ("recipientsAnkora" @> ARRAY['ariel@ankora.co.il', 'hadas@ankora.co.il']::TEXT[])
  );
