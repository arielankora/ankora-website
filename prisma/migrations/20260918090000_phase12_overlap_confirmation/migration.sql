-- Phase 12: "אישור דיווח שעות חופף בין לקוחות שונים" (cross-client overlap
-- confirmation).
--
-- Hand-authored for the same reason as every prior phase's migration (see
-- their own header comments and docs/adr/0001's "Known limitations"): this
-- sandbox has no network route to Prisma's engine CDN, so `prisma migrate
-- dev` cannot run here. Written to match prisma/schema.prisma exactly and
-- verified by inspection against every prior hand-authored migration's own
-- generated style. Additive only, single boolean column with a default -
-- no existing column/table/constraint is dropped or altered destructively.

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "isOverlapConfirmed" BOOLEAN NOT NULL DEFAULT false;
