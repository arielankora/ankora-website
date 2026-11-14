-- Processes redesign, stage 3 (14.11.2026), spec 6.3, the automatic part
-- (Ariel, 14.11.2026): the approver a process names as an Ankora user, or as
-- a linked contact, moves to every step of its versions that asks for an
-- approval and names no approver yet. In `steps`, and in the steps of a
-- flow's nodes. An approver written only as free text is not guessed: a
-- list is put to Ariel first.
--
-- Idempotent: a step that already names an approver is left as it is.

CREATE OR REPLACE FUNCTION pg_temp.with_approver(step jsonb, user_id text, contact_id text) RETURNS jsonb AS $$
  SELECT CASE
    WHEN step IS NULL OR jsonb_typeof(step) <> 'object' THEN step
    WHEN COALESCE((step->>'requiresApproval')::boolean, false) IS NOT TRUE THEN step
    WHEN COALESCE(step->>'approverUserId', '') <> '' OR COALESCE(step->>'approverContactId', '') <> '' THEN step
    WHEN user_id IS NOT NULL THEN step || jsonb_build_object('approverUserId', user_id)
    WHEN contact_id IS NOT NULL THEN step || jsonb_build_object('approverContactId', contact_id)
    ELSE step
  END
$$ LANGUAGE sql IMMUTABLE;

UPDATE "process_versions" v
SET "steps" = (
  SELECT COALESCE(jsonb_agg(pg_temp.with_approver(e, p."approverUserId", p."approverContactId") ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements(v."steps") WITH ORDINALITY AS t(e, i)
)
FROM "processes" p
WHERE p."id" = v."processId"
  AND (p."approverUserId" IS NOT NULL OR p."approverContactId" IS NOT NULL)
  AND jsonb_typeof(v."steps") = 'array';

UPDATE "process_versions" v
SET "flow" = jsonb_set(v."flow", '{nodes}', (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN jsonb_typeof(n->'step') = 'object'
      THEN jsonb_set(n, '{step}', pg_temp.with_approver(n->'step', p."approverUserId", p."approverContactId"))
      ELSE n END ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements(v."flow"->'nodes') WITH ORDINALITY AS t(n, i)
))
FROM "processes" p
WHERE p."id" = v."processId"
  AND (p."approverUserId" IS NOT NULL OR p."approverContactId" IS NOT NULL)
  AND v."flow" IS NOT NULL
  AND jsonb_typeof(v."flow"->'nodes') = 'array';
