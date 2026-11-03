-- At most one OPEN (unresolved) alert event per rule and cycle.
--
-- decideAlertAction() never fires while an unresolved event exists, so this
-- is already the invariant the code means to keep. It was only enforced by a
-- read followed by a create, so two evaluations of the same client running
-- at once (every time-entry write evaluates in after(), since #87) both saw
-- no open event and both fired: two events, two pairs of emails.
--
-- Not expressible in schema.prisma (no partial-unique-index DSL), same as
-- time_entries_one_active_per_user. lib/app-domain/alerts.ts catches the
-- violation and treats it as "someone else already fired".

-- Duplicates that the race has already produced would make the index fail
-- to build. Keep the newest open event of each pair and resolve the older
-- ones; nothing is deleted, and no email is sent for a resolve.
UPDATE "alert_events"
SET "resolvedAt" = now()
WHERE "resolvedAt" IS NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("ruleId", "hourBankId") "id"
    FROM "alert_events"
    WHERE "resolvedAt" IS NULL
    ORDER BY "ruleId", "hourBankId", "triggeredAt" DESC, "id" DESC
  );

-- CreateIndex
CREATE UNIQUE INDEX "alert_events_one_open_per_rule_bank"
  ON "alert_events"("ruleId", "hourBankId")
  WHERE "resolvedAt" IS NULL;
