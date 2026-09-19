-- Phase 12 (Profile & Guide redesign, docs/adr/0001 section 23). Hand-
-- authored for the same reason as every prior phase's migration (see their
-- own header comments): this sandbox has no network route to Prisma's
-- engine CDN, so `prisma migrate dev` cannot run here. The first real
-- `prisma migrate dev`/`migrate deploy` run anywhere with network access
-- should detect this as already applied/in sync with schema.prisma.

-- AlterTable: one real per-user notification preference, backing the
-- redesigned Profile screen's "התראות אישיות" toggle. Default true so
-- every existing user keeps receiving the long-running-timer email they
-- already get today (lib/app-domain/notifications.ts's
-- notifyLongRunningTimers()) until they explicitly opt out.
ALTER TABLE "users" ADD COLUMN "notifyLongRunningTimerByEmail" BOOLEAN NOT NULL DEFAULT true;
