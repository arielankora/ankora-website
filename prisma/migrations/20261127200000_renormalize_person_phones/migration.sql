-- Contacts' phones, written again in the one form the WhatsApp screen
-- compares (27.11.2026, Ariel: a chat is matched to a client by the
-- contact's number, so a number stored in another form is never found).
-- The same rules as normalizePhone in lib/contact-normalize.ts, for what
-- is already stored: the zero kept after +972 ("+9720521234567"), an
-- Israeli mobile stored without its zero or its code ("521234567"), and
-- any older value stored with dashes, spaces or brackets. Order is kept
-- and duplicates that now meet are dropped. A value that matches no rule
-- is left as it is.

CREATE TEMP TABLE "_phone_fix" AS
SELECT p.id, p.phones AS before, (
  SELECT COALESCE(array_agg(n ORDER BY first_pos), '{}')
  FROM (
    SELECT n, min(pos) AS first_pos
    FROM (
      SELECT pos,
        CASE
          WHEN d ~ '^\+9720[0-9]{8,9}$' THEN '+972' || substr(d, 6)
          WHEN d ~ '^\+[0-9]{7,15}$' THEN d
          WHEN d ~ '^009720[0-9]{8,9}$' THEN '+972' || substr(d, 7)
          WHEN d ~ '^00[0-9]{7,15}$' THEN '+' || substr(d, 3)
          WHEN d ~ '^9720[0-9]{8,9}$' THEN '+972' || substr(d, 5)
          WHEN d ~ '^972[0-9]{8,9}$' THEN '+' || d
          WHEN d ~ '^0[0-9]{8,9}$' THEN '+972' || substr(d, 2)
          WHEN d ~ '^5[0-9]{8}$' THEN '+972' || d
          ELSE raw
        END AS n
      FROM (
        SELECT pos, raw, regexp_replace(regexp_replace(raw, '\(\s*0\s*\)', '', 'g'), '[^0-9+]', '', 'g') AS d
        FROM unnest(p.phones) WITH ORDINALITY AS u(raw, pos)
      ) parts
    ) cleaned
    GROUP BY n
  ) deduped
) AS after
FROM "persons" p
WHERE cardinality(p.phones) > 0;

UPDATE "persons" p
SET phones = f.after
FROM "_phone_fix" f
WHERE p.id = f.id AND f.after IS DISTINCT FROM f.before;

-- What changed, kept for the report to Ariel: how many people, and how
-- many numbers were rewritten.
INSERT INTO "app_settings" ("key", "value", "updatedAt")
SELECT 'phones.renormalizedAt20261127',
  jsonb_build_object(
    'people', count(*),
    'numbersBefore', COALESCE(sum(cardinality(before)), 0),
    'numbersAfter', COALESCE(sum(cardinality(after)), 0),
    'numbersRewritten', COALESCE(sum((SELECT count(*) FROM unnest(before) b WHERE NOT b = ANY(after))), 0)
  ),
  now()
FROM "_phone_fix"
WHERE after IS DISTINCT FROM before
ON CONFLICT ("key") DO NOTHING;

DROP TABLE "_phone_fix";
