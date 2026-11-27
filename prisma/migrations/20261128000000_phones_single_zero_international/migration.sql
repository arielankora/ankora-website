-- Contacts' phones written as an international number with one 0 instead
-- of 00 ("0974 4422 ....", 27.11.2026: four contacts of one client), in the
-- form the WhatsApp screen compares. The same rule as normalizePhone in
-- lib/contact-normalize.ts: one 0 before a code from 970 to 979, and the
-- result too long to be Israeli. The zero kept after +972 is dropped as
-- before. Order is kept and duplicates that now meet are dropped. Every
-- other value is left as it is.

CREATE TEMP TABLE "_phone_fix" AS
SELECT p.id, p.phones AS before, (
  SELECT COALESCE(array_agg(n ORDER BY first_pos), '{}')
  FROM (
    SELECT n, min(pos) AS first_pos
    FROM (
      SELECT pos,
        CASE
          WHEN d ~ '^09720[0-9]{8,9}$' THEN '+972' || substr(d, 6)
          WHEN d ~ '^097[0-9]{9,11}$' THEN '+' || substr(d, 2)
          ELSE raw
        END AS n
      FROM (
        SELECT pos, raw, regexp_replace(raw, '[^0-9+]', '', 'g') AS d
        FROM unnest(p.phones) WITH ORDINALITY AS u(raw, pos)
      ) parts
    ) cleaned
    GROUP BY n
  ) deduped
) AS after
FROM "persons" p
WHERE EXISTS (SELECT 1 FROM unnest(p.phones) ph WHERE regexp_replace(ph, '[^0-9+]', '', 'g') ~ '^097[0-9]{9,11}$');

UPDATE "persons" p
SET phones = f.after
FROM "_phone_fix" f
WHERE p.id = f.id AND f.after IS DISTINCT FROM f.before;

-- What changed, kept for the report to Ariel.
INSERT INTO "app_settings" ("key", "value", "updatedAt")
SELECT 'phones.singleZeroInternational20261128',
  jsonb_build_object(
    'people', count(*),
    'numbersRewritten', COALESCE(sum((SELECT count(*) FROM unnest(before) b WHERE NOT b = ANY(after))), 0)
  ),
  now()
FROM "_phone_fix"
WHERE after IS DISTINCT FROM before
ON CONFLICT ("key") DO NOTHING;

DROP TABLE "_phone_fix";
