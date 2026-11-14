-- Processes redesign, stage 3, spec 6.3 (Ariel, 14.11.2026): the approvers
-- of NUX's approval steps that were written only as text, each approved by
-- Ariel by name. Guy leaves on 15.11.2026, so none of them is Guy.
--
--   P2  step 4 (approving the payments in the bank's app): Yonatan, at the client
--   P8  step 7 (approving JustWorks' ACH pull in Mercury): Oren, at the client
--   P12 step 5 (the funding request): Hadas, at Ankora
--   P12 step 6 (the transfer from Treasury): Oren, at the client
--   P13 step 5 (approving Ayala to upload the payroll): Hadas, at Ankora
--
-- Only the approved version, only a step that asks for an approval and
-- names no approver yet, and only when the person is the client's contact
-- or an active user. Idempotent: a second run changes nothing.

CREATE OR REPLACE FUNCTION pg_temp.set_step_approver(process_id text, step_no int, field text, person_id text) RETURNS void AS $$
  UPDATE "process_versions" v
  SET "steps" = jsonb_set(v."steps", ARRAY[(step_no - 1)::text], (v."steps"->(step_no - 1)) || jsonb_build_object(field, person_id))
  WHERE v."processId" = process_id
    AND v."status" = 'APPROVED'
    AND jsonb_typeof(v."steps"->(step_no - 1)) = 'object'
    AND COALESCE((v."steps"->(step_no - 1)->>'requiresApproval')::boolean, false)
    AND COALESCE(v."steps"->(step_no - 1)->>'approverUserId', '') = ''
    AND COALESCE(v."steps"->(step_no - 1)->>'approverContactId', '') = ''
    AND v."flow" IS NULL
    AND (
      (field = 'approverContactId' AND EXISTS (
        SELECT 1 FROM "client_contacts" c JOIN "processes" p ON p."clientId" = c."clientId"
        WHERE c."id" = person_id AND p."id" = process_id AND c."deletedAt" IS NULL))
      OR (field = 'approverUserId' AND EXISTS (
        SELECT 1 FROM "users" u WHERE u."id" = person_id AND u."deletedAt" IS NULL AND u."status" = 'ACTIVE'))
    );
$$ LANGUAGE sql;

SELECT pg_temp.set_step_approver('cmvgiph6d000hjs08l48i79z6', 4, 'approverContactId', 'cmvcgvfes0003jj07uufzkz0m');
SELECT pg_temp.set_step_approver('cmw0z4t0x000pig08ejn6ls0e', 7, 'approverContactId', 'cmvdxfi2l0003l708cia0094i');
SELECT pg_temp.set_step_approver('cmw3x1br8002vjw073cmhkyhu', 5, 'approverUserId', 'cmto4lrj80002jp04u7ezj0by');
SELECT pg_temp.set_step_approver('cmw3x1br8002vjw073cmhkyhu', 6, 'approverContactId', 'cmvdxfi2l0003l708cia0094i');
SELECT pg_temp.set_step_approver('cmw9emaft0025jv08p04ew79j', 5, 'approverUserId', 'cmto4lrj80002jp04u7ezj0by');
