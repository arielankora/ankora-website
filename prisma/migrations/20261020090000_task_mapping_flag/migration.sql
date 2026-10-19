-- A mapping task is marked on the task itself (20.10.2026). Until now it
-- was recognised only by the handover line in its description.
ALTER TABLE "tasks" ADD COLUMN "mappingTask" BOOLEAN NOT NULL DEFAULT false;

-- Tasks already in the "mapping and watching" stage keep being checked.
UPDATE "tasks"
SET "mappingTask" = true
WHERE "parentId" IS NULL
  AND "description" ~ 'שלב:\s*מיפוי\s+וצפייה';
