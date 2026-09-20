-- Phase 14 (MCP server writes, docs/adr/0005). Hand-authored for the same
-- reason as every prior phase's migration (see their own header comments):
-- the environment this was built in has no network route to Prisma's engine
-- CDN, so `prisma migrate dev` cannot run here. The first real
-- `prisma migrate dev`/`migrate deploy` run anywhere with network access
-- should detect this as already applied/in sync with schema.prisma.

-- CreateEnum: WHERE an entry was created from. Deliberately separate from
-- TimeEntrySource, which records HOW (timer vs typed form) - the two are
-- orthogonal, and a timer Claude started is TIMER + MCP.
CREATE TYPE "EntryOrigin" AS ENUM ('APP', 'MCP');

-- AlterTable: every existing row predates the MCP server, so DEFAULT 'APP'
-- labels the backfill correctly rather than leaving it unknown. NOT NULL is
-- safe precisely because of that default.
ALTER TABLE "time_entries" ADD COLUMN "createdVia" "EntryOrigin" NOT NULL DEFAULT 'APP';
