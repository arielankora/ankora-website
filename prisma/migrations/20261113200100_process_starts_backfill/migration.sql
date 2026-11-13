-- 13.11.2026 (processes redesign, stage 1; spec 6.2): every process gets the
-- starts its trigger kinds already said, and its dates are tied to its
-- schedule start. Nothing that schedules work changes for a process that is
-- not named below: its dates stay exactly as they are ({"legacy": true})
-- until someone edits its rhythm.
--
-- Ids are derived from the process id, one start of each kind per process,
-- so the dates can be tied in the same pass and a rerun inserts nothing.

-- What the trigger said in words stays, as notes on the rhythm.
UPDATE "processes" SET "triggerNotes" = "triggerText"
WHERE "triggerText" IS NOT NULL AND "triggerNotes" IS NULL;

-- By a date: one schedule start, holding the dates already linked.
INSERT INTO "process_starts" ("id", "processId", "clientId", "kind", "schedule", "sortOrder", "updatedAt")
SELECT 'pss_' || p."id", p."id", p."clientId", 'SCHEDULE', '{"legacy": true}'::jsonb, 0, CURRENT_TIMESTAMP
FROM "processes" p
WHERE 'SCHEDULED' = ANY (p."triggerKinds")
ON CONFLICT ("id") DO NOTHING;

UPDATE "important_dates" d SET "processStartId" = 'pss_' || d."processId"
WHERE d."processId" IS NOT NULL
  AND d."processStartId" IS NULL
  AND EXISTS (SELECT 1 FROM "process_starts" s WHERE s."id" = 'pss_' || d."processId");

-- When something happens: the words of the trigger.
INSERT INTO "process_starts" ("id", "processId", "clientId", "kind", "description", "sortOrder", "updatedAt")
SELECT 'pse_' || p."id", p."id", p."clientId", 'EVENT', p."triggerText", 1, CURRENT_TIMESTAMP
FROM "processes" p
WHERE 'EVENT' = ANY (p."triggerKinds")
ON CONFLICT ("id") DO NOTHING;

-- On request.
INSERT INTO "process_starts" ("id", "processId", "clientId", "kind", "sortOrder", "updatedAt")
SELECT 'psr_' || p."id", p."id", p."clientId", 'ON_DEMAND', 2, CURRENT_TIMESTAMP
FROM "processes" p
WHERE 'ON_DEMAND' = ANY (p."triggerKinds")
ON CONFLICT ("id") DO NOTHING;

-- Ongoing, with its check, except the four Ariel decided otherwise below.
INSERT INTO "process_starts" ("id", "processId", "clientId", "kind", "checkEveryDays", "checkText", "sortOrder", "updatedAt")
SELECT 'psc_' || p."id", p."id", p."clientId", 'CONTINUOUS', p."checkEveryDays", p."checkText", 3, CURRENT_TIMESTAMP
FROM "processes" p
WHERE 'CONTINUOUS' = ANY (p."triggerKinds")
  AND p."id" NOT IN ('cmw100voi000bk108j24crz2b', 'cmvjvy1o0000dl108cg86naph', 'cmw0jwz0a000dl80830b3ixwc', 'cmw0ob7p5001bl408o0efb1cw')
ON CONFLICT ("id") DO NOTHING;

-- Ariel, 13.11.2026: "every working day" processes marked ongoing with no
-- check (Grantor P7, 9:00 status reminder; Maya P1, the leads inbox) run
-- every business day. A daily date is created for each, as the process card
-- creates one: titled after the process, its owner responsible, no
-- reminders. The daily job computes its next occurrence.
INSERT INTO "process_starts" ("id", "processId", "clientId", "kind", "schedule", "sortOrder", "updatedAt")
SELECT 'pss_' || p."id", p."id", p."clientId", 'SCHEDULE',
       '{"frequency": "BUSINESS_DAILY", "weekdays": [], "monthDays": [], "quarterMonth": 1, "yearDates": [], "onceDate": null, "roll": "NONE"}'::jsonb,
       0, CURRENT_TIMESTAMP
FROM "processes" p
WHERE p."id" IN ('cmw100voi000bk108j24crz2b', 'cmvjvy1o0000dl108cg86naph')
  AND p."deletedAt" IS NULL
  AND p."ownerId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "important_dates" (
  "id", "clientId", "title", "type", "category", "calendarType", "month", "day",
  "recurrence", "responsibleUserId", "additionalUserIds", "extraEmailRecipients",
  "processId", "processStartId", "updatedAt"
)
SELECT 'psd_' || p."id", p."clientId", left(p."code" || ' ' || p."title", 200), 'CLIENT', 'GENERAL', 'GREGORIAN', 1, 1,
       'BUSINESS_DAILY', p."ownerId", ARRAY[]::TEXT[], ARRAY[]::TEXT[],
       p."id", 'pss_' || p."id", CURRENT_TIMESTAMP
FROM "processes" p
WHERE p."id" IN ('cmw100voi000bk108j24crz2b', 'cmvjvy1o0000dl108cg86naph')
  AND EXISTS (SELECT 1 FROM "process_starts" s WHERE s."id" = 'pss_' || p."id")
ON CONFLICT ("id") DO NOTHING;

UPDATE "processes" SET "triggerKinds" = ARRAY['SCHEDULED']::"ProcessTrigger"[]
WHERE "id" IN ('cmw100voi000bk108j24crz2b', 'cmvjvy1o0000dl108cg86naph')
  AND EXISTS (SELECT 1 FROM "process_starts" s WHERE s."id" = 'pss_' || "processes"."id");

-- Ariel, 13.11.2026: the daily ops report (P13) and the meeting agent (P15)
-- of Ankora's own file run as scheduled tasks of Claude, outside the app.
INSERT INTO "process_starts" ("id", "processId", "clientId", "kind", "externalWhere", "externalWhen", "sortOrder", "updatedAt")
SELECT 'psx_' || p."id", p."id", p."clientId", 'EXTERNAL', 'משימה מתוזמנת של Claude',
       CASE p."id" WHEN 'cmw0jwz0a000dl80830b3ixwc' THEN 'כל יום ב-07:40' ELSE 'כל יום ב-01:53 וב-18:23' END,
       4, CURRENT_TIMESTAMP
FROM "processes" p
WHERE p."id" IN ('cmw0jwz0a000dl80830b3ixwc', 'cmw0ob7p5001bl408o0efb1cw')
ON CONFLICT ("id") DO NOTHING;

UPDATE "processes" SET "triggerKinds" = ARRAY['EXTERNAL']::"ProcessTrigger"[]
WHERE "id" IN ('cmw0jwz0a000dl80830b3ixwc', 'cmw0ob7p5001bl408o0efb1cw')
  AND EXISTS (SELECT 1 FROM "process_starts" s WHERE s."id" = 'psx_' || "processes"."id");
