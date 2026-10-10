-- 9.10.2026: every client is watched by default (see DEFAULT_ALERT_RULES
-- in lib/app-domain/alerts.ts).
--
-- 1. alert_rules.notifyAccountManager: a rule can also mail the client's
--    account manager, resolved when it fires, so a change of account
--    manager is followed without editing rules.
-- 2. Every client that is not archived or deleted gets the two default
--    rules, utilization at 80% and at 100%, unless it already has a rule
--    with that exact type and threshold. They mail Ariel, Hadas and the
--    client's account manager (Ankora side only). Nothing goes to the
--    client: that stays a person's decision on the Alerts screen.
--
-- The nightly reconciliation evaluates them on its next run, as does any
-- time entry saved for the client before then.
ALTER TABLE "alert_rules" ADD COLUMN "notifyAccountManager" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "alert_rules" ("id", "clientId", "type", "thresholdValue", "recipientsAnkora", "recipientsClient", "enabled", "allowRetrigger", "notifyAccountManager", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'UTILIZATION_PCT'::"AlertThresholdType", d.threshold,
       ARRAY['ariel@ankora.co.il', 'hadas@ankora.co.il']::TEXT[], ARRAY[]::TEXT[], true, false, true,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "clients" c
CROSS JOIN (VALUES (80), (100)) AS d(threshold)
WHERE c."status" <> 'ARCHIVED'
  AND c."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "alert_rules" r
    WHERE r."clientId" = c."id" AND r."type" = 'UTILIZATION_PCT' AND r."thresholdValue" = d.threshold
  );
