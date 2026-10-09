-- 9.10.2026: every client is watched by default (see DEFAULT_ALERT_RULES
-- in lib/app-domain/alerts.ts).
--
-- Data only, no schema change. Gives every client that is not archived
-- the two default rules, utilization at 80% and at 100%, unless it
-- already has a rule with that exact type and threshold. No recipients:
-- a breach becomes an open alert in the app, and nobody is mailed until
-- a person adds recipients on the Alerts screen.
--
-- The nightly reconciliation evaluates them on its next run, as does any
-- time entry saved for the client before then.
INSERT INTO "alert_rules" ("id", "clientId", "type", "thresholdValue", "recipientsAnkora", "recipientsClient", "enabled", "allowRetrigger", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'UTILIZATION_PCT'::"AlertThresholdType", d.threshold, ARRAY[]::TEXT[], ARRAY[]::TEXT[], true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "clients" c
CROSS JOIN (VALUES (80), (100)) AS d(threshold)
WHERE c."status" <> 'ARCHIVED'
  AND c."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "alert_rules" r
    WHERE r."clientId" = c."id" AND r."type" = 'UTILIZATION_PCT' AND r."thresholdValue" = d.threshold
  );
