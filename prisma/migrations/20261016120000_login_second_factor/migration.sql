-- 16.10.2026: two-step sign-in with a passkey. A client opt-in flag on
-- users, and the pending sign-in between the first factor and the passkey.
ALTER TABLE "users" ADD COLUMN "loginPasskeyRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pending_logins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "secondFactor" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_logins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pending_logins_tokenHash_key" ON "pending_logins"("tokenHash");
CREATE INDEX "pending_logins_userId_idx" ON "pending_logins"("userId");
ALTER TABLE "pending_logins" ADD CONSTRAINT "pending_logins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
