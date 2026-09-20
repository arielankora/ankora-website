-- Phase 15 (MCP OAuth, docs/adr/0005). Hand-authored for the same reason
-- as every prior phase's migration (see their own header comments): the
-- environment this was built in has no network route to Prisma's engine
-- CDN, so `prisma migrate dev` cannot run here. The first real
-- `prisma migrate dev`/`migrate deploy` run anywhere with network access
-- should detect this as already applied/in sync with schema.prisma.

-- CreateTable: OAuth clients, one row per connection Claude registers
-- through Dynamic Client Registration (RFC 7591). clientSecretHash is
-- nullable because DCR registers a PUBLIC client - it authenticates with
-- PKCE and no secret.
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "grantTypes" TEXT[],
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_clients_clientId_key" ON "oauth_clients"("clientId");

-- CreateTable: single-use authorization codes, bound to a PKCE challenge
-- and to the RFC 8707 resource they were minted for.
CREATE TABLE "oauth_authorization_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_authorization_codes_codeHash_key" ON "oauth_authorization_codes"("codeHash");
CREATE INDEX "oauth_authorization_codes_clientId_idx" ON "oauth_authorization_codes"("clientId");
CREATE INDEX "oauth_authorization_codes_userId_idx" ON "oauth_authorization_codes"("userId");

-- CreateTable: issued access/refresh pairs. Rotation writes a NEW row and
-- points the old one at it through "rotatedToId", so replaying a refresh
-- token that already rotated is detectable rather than silent.
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedToId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_tokens_accessTokenHash_key" ON "oauth_tokens"("accessTokenHash");
CREATE UNIQUE INDEX "oauth_tokens_refreshTokenHash_key" ON "oauth_tokens"("refreshTokenHash");
CREATE INDEX "oauth_tokens_userId_revokedAt_idx" ON "oauth_tokens"("userId", "revokedAt");
CREATE INDEX "oauth_tokens_clientId_idx" ON "oauth_tokens"("clientId");

-- AddForeignKey: deleting a user takes their grants with them, and
-- deleting a client takes its codes and tokens. Hard cascades rather than
-- the soft-delete pattern used for domain data, for the same reason
-- mcp_access_tokens cascades: a credential must never outlive its owner.
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
