-- 9.10.2026: mark Ankora's own internal client so the home-page hours
-- chart can leave it out. Internal hours are still logged, reported and
-- exported as before; only the client-work chart ignores them.
ALTER TABLE "clients" ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- The one internal client that exists today. Matched by name because
-- there was no flag until now; any future internal client is marked
-- with the flag directly.
UPDATE "clients" SET "isInternal" = true WHERE "name" = 'Ankora פנימי';
