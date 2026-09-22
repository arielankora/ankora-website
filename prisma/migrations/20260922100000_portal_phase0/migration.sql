-- Portal phase 0: one-time sign-in links for client portal users.
CREATE TABLE "portal_login_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_login_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_login_tokens_tokenHash_key" ON "portal_login_tokens"("tokenHash");
CREATE INDEX "portal_login_tokens_userId_idx" ON "portal_login_tokens"("userId");

ALTER TABLE "portal_login_tokens" ADD CONSTRAINT "portal_login_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
