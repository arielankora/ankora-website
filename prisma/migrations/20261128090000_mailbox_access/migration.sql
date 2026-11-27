-- A client mailbox's list of people (27.11.2026). Starts empty: the system
-- admins, the account manager and the backup manager reach every client
-- mailbox by role; anyone else is added on the connections screen.
CREATE TABLE "mailbox_access" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canSend" BOOLEAN NOT NULL DEFAULT true,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mailbox_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mailbox_access_connectionId_userId_key" ON "mailbox_access"("connectionId", "userId");
CREATE INDEX "mailbox_access_userId_idx" ON "mailbox_access"("userId");

ALTER TABLE "mailbox_access" ADD CONSTRAINT "mailbox_access_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "client_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_access" ADD CONSTRAINT "mailbox_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
