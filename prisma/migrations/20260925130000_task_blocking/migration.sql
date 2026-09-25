-- Tasks phase 5: "חסימה פשוטה".
--
-- This generalises `waitingOnClientSince`, which has been on the table
-- since portal phase 1 and covered exactly one blocker. Every row that
-- was waiting on a client keeps waiting, with the same date, and gains
-- the blocker it always implied.
--
-- Order matters here: the enum, then the columns, then the backfill,
-- and only then the drop. A drop before the backfill loses every
-- currently-waiting promise, which is the one thing in this table a
-- client is looking at right now.
CREATE TYPE "TaskBlocker" AS ENUM ('CLIENT', 'SUPPLIER', 'INTERNAL', 'OTHER');

ALTER TABLE "tasks" ADD COLUMN "blockedSince" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "blockedOn" "TaskBlocker";
ALTER TABLE "tasks" ADD COLUMN "blockedReason" TEXT;

UPDATE "tasks"
   SET "blockedSince" = "waitingOnClientSince",
       "blockedOn" = 'CLIENT'
 WHERE "waitingOnClientSince" IS NOT NULL;

ALTER TABLE "tasks" DROP COLUMN "waitingOnClientSince";

CREATE INDEX "tasks_blockedOn_blockedSince_idx" ON "tasks"("blockedOn", "blockedSince");
