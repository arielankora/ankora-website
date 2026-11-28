-- 28.11.2026 (Ariel, via Ankora Ops): a simple update (SUPERSEDE) at a high
-- review level enters a client file on its own. A person looks at every
-- such update for its first 14 days, counted from now (deploy time), then
-- the usual 20% sample (lib/auto-apply.ts).
UPDATE "app_settings"
SET "value" = "value" || jsonb_build_object('supersedeEnabledAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    "updatedAt" = now()
WHERE "key" = 'knowledge.auto_apply' AND NOT ("value" ? 'supersedeEnabledAt');
