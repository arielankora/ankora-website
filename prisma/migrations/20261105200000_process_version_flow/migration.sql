-- A procedure as a flow with conditions and branches (4.11.2026, task
-- cmvtivumj000pjs08q9qj4t67). See lib/process-flow.ts.
--
-- Additive only: existing versions keep flow NULL and are read as the list
-- they are. When flow is set, steps is derived from it on save, so every
-- reader of steps is unchanged.

-- Idempotent (IF NOT EXISTS): the prototype's preview database applied this
-- change under an earlier migration name before the branch was rebased.

-- AlterTable
ALTER TABLE "process_versions" ADD COLUMN IF NOT EXISTS "flow" JSONB;
