-- A client archived from its settings form got status ARCHIVED but kept
-- deletedAt NULL: it stayed on the client list with a screen that could
-- not open, and its portal users kept their access. Archiving now always
-- sets both (updateClient, as archiveClient already did). This brings the
-- clients archived the old way into the same state.
UPDATE "clients" SET "deletedAt" = NOW() WHERE "status" = 'ARCHIVED' AND "deletedAt" IS NULL;
