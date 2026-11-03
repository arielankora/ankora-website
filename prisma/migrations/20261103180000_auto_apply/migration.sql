-- 3.11.2026: approval tiers, part 2. Proposals in the AUTO tier enter the
-- file on arrival. A person looks at some of them after the fact, kinds
-- and clients with too many errors go back to a person, and one switch
-- turns it all off.
ALTER TABLE "knowledge_proposals" ADD COLUMN "autoReviewedAt" TIMESTAMP(3);
ALTER TABLE "knowledge_proposals" ADD COLUMN "autoReviewedById" TEXT;
CREATE INDEX "knowledge_proposals_autoApplied_decidedAt_idx" ON "knowledge_proposals"("autoApplied", "decidedAt");

CREATE TYPE "AutoApplyScope" AS ENUM ('KIND', 'CLIENT');

CREATE TABLE "auto_apply_pauses" (
    "id" TEXT NOT NULL,
    "scope" "AutoApplyScope" NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "errors" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,

    CONSTRAINT "auto_apply_pauses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auto_apply_pauses_scope_key_liftedAt_idx" ON "auto_apply_pauses"("scope", "key", "liftedAt");

CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- On from the merge: the switch starts on, and the first 14 days, when a
-- person looks at every auto-applied item, start now.
INSERT INTO "app_settings" ("key", "value", "updatedAt")
VALUES ('knowledge.auto_apply', jsonb_build_object('enabled', true, 'firstEnabledAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), now());
