-- "מי לא יראה: כולם" on a connected WhatsApp number (5.11.2026).
-- See CommsChannel.excludeAllViewers in schema.prisma and lib/comms/visibility.ts.
--
-- Additive only: one column with a default, so every existing number keeps
-- its current list and nothing changes until someone ticks "כולם".

-- AlterTable
ALTER TABLE "comms_channels" ADD COLUMN "excludeAllViewers" BOOLEAN NOT NULL DEFAULT false;
