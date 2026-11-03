-- 3.11.2026: whether a client's contract commits Ankora to tell it, by email
-- and ahead of time, about a new sub-processor (P8 step 8). Every existing
-- client starts as UNCHECKED: nobody has read the contracts for this yet,
-- and an unchecked client is emailed to be safe.
CREATE TYPE "SubprocessorNotice" AS ENUM ('UNCHECKED', 'COMMITTED', 'NOT_COMMITTED');

ALTER TABLE "clients" ADD COLUMN "subprocessorNotice" "SubprocessorNotice" NOT NULL DEFAULT 'UNCHECKED',
ADD COLUMN "subprocessorNoticeSource" TEXT,
ADD COLUMN "subprocessorNoticeDocumentId" TEXT,
ADD COLUMN "subprocessorNoticeCheckedAt" TIMESTAMP(3),
ADD COLUMN "subprocessorNoticeCheckedById" TEXT;

ALTER TABLE "clients" ADD CONSTRAINT "clients_subprocessorNoticeDocumentId_fkey" FOREIGN KEY ("subprocessorNoticeDocumentId") REFERENCES "client_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "clients" ADD CONSTRAINT "clients_subprocessorNoticeCheckedById_fkey" FOREIGN KEY ("subprocessorNoticeCheckedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
