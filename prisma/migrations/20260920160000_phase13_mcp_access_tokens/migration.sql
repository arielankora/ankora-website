-- Phase 13 (MCP server, docs/adr/0005). Hand-authored for the same reason
-- as every prior phase's migration (see their own header comments): the
-- environment this was built in has no network route to Prisma's engine
-- CDN, so `prisma migrate dev` cannot run here. The first real
-- `prisma migrate dev`/`migrate deploy` run anywhere with network access
-- should detect this as already applied/in sync with schema.prisma.

-- CreateTable: per-user personal access tokens for /api/mcp. Only the
-- SHA-256 hash is stored, same as "password_reset_tokens".
CREATE TABLE "mcp_access_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the hash is the lookup key on every single MCP request, so
-- it must be unique and indexed (see the model comment in schema.prisma
-- for why this replaces a constant-time compare rather than complementing
-- one).
CREATE UNIQUE INDEX "mcp_access_tokens_tokenHash_key" ON "mcp_access_tokens"("tokenHash");

-- CreateIndex: backs the "list / revoke my own tokens" query.
CREATE INDEX "mcp_access_tokens_userId_revokedAt_idx" ON "mcp_access_tokens"("userId", "revokedAt");

-- AddForeignKey: deleting a user takes their tokens with them. This is a
-- hard cascade rather than the soft-delete pattern used for domain data
-- on purpose - a credential must never outlive its owner's row.
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
