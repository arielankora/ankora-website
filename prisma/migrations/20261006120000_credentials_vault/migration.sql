-- Credentials vault (claude/credentials-vault-spec-2026-10-06.md,
-- approved by Ariel 6.10.2026).
-- ----------------------------------------------------------------------
-- Two tables and one guard.
--
-- client_credentials holds a client's logins. Only systemName and url are
-- plain text. Username, password and notes are one encrypted blob; the
-- key that wraps each row's data key lives in Cloud KMS, not here.
--
-- step_up_grants is the short "verified it's you" window that a reveal
-- requires.
--
-- The guard makes audit_events append-only. A vault whose access log can
-- be edited proves nothing, and until now nothing stopped an UPDATE or a
-- DELETE on that table. Two things must still work:
--   * the foreign keys are ON DELETE SET NULL, so Postgres itself updates
--     actorId/clientId if a user or client row is ever hard-deleted. That
--     one shape of update (only those two columns, only to NULL) passes.
--   * TRUNCATE, which the test suites run before every test. A row-level
--     trigger never fires on TRUNCATE, so nothing extra is needed.

CREATE TABLE "client_credentials" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "systemName" TEXT NOT NULL,
    "url" TEXT,
    "secretCiphertext" BYTEA,
    "secretIv" BYTEA,
    "secretTag" BYTEA,
    "wrappedDek" BYTEA,
    "kekRef" TEXT,
    "encVersion" INTEGER NOT NULL DEFAULT 1,
    "hasUsername" BOOLEAN NOT NULL DEFAULT false,
    "hasPassword" BOOLEAN NOT NULL DEFAULT false,
    "hasNotes" BOOLEAN NOT NULL DEFAULT false,
    "secretUpdatedAt" TIMESTAMP(3),
    "lastRevealedAt" TIMESTAMP(3),
    "lastRevealedById" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_credentials_clientId_deletedAt_idx" ON "client_credentials"("clientId", "deletedAt");

ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_lastRevealedById_fkey" FOREIGN KEY ("lastRevealedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A deleted credential keeps no secret. Enforced here as well as in code,
-- so a future code path that forgets cannot leave ciphertext on a row the
-- product considers gone.
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_deleted_has_no_secret"
  CHECK ("deletedAt" IS NULL OR ("secretCiphertext" IS NULL AND "wrappedDek" IS NULL));

CREATE TABLE "step_up_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "step_up_grants_userId_expiresAt_idx" ON "step_up_grants"("userId", "expiresAt");

ALTER TABLE "step_up_grants" ADD CONSTRAINT "step_up_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- audit_events: append-only.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_events is append-only (DELETE refused)';
  END IF;
  -- The single update Postgres itself performs: ON DELETE SET NULL.
  IF NEW."id" = OLD."id"
     AND NEW."action" = OLD."action"
     AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" IS NOT DISTINCT FROM OLD."entityId"
     AND NEW."beforeJson"::text IS NOT DISTINCT FROM OLD."beforeJson"::text
     AND NEW."afterJson"::text IS NOT DISTINCT FROM OLD."afterJson"::text
     AND NEW."ip" IS NOT DISTINCT FROM OLD."ip"
     AND NEW."userAgent" IS NOT DISTINCT FROM OLD."userAgent"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."actorId" IS NOT DISTINCT FROM OLD."actorId" OR NEW."actorId" IS NULL)
     AND (NEW."clientId" IS NOT DISTINCT FROM OLD."clientId" OR NEW."clientId" IS NULL)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (UPDATE refused)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
