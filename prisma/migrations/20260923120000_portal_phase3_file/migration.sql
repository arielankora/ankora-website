-- Portal phase 3: the client's file, and the monthly summary.
--
-- Additive only. Four additions, and one of them is deliberately NOT a
-- new table.
--
-- Suppliers do not get an entity. The 22.9.2026 decision on the spec is
-- explicit: a supplier is recorded as one field on the task at the moment
-- it closes, and the client's supplier list is DERIVED from their tasks
-- rather than maintained beside them. A Supplier table would be a second
-- place to type the same thing, and a second place to type something is
-- the first thing abandoned under load.

CREATE TYPE "SupplierExperience" AS ENUM ('GOOD', 'OK', 'AVOID');

ALTER TABLE "tasks" ADD COLUMN "supplierName" TEXT;
ALTER TABLE "tasks" ADD COLUMN "supplierExperience" "SupplierExperience";
ALTER TABLE "tasks" ADD COLUMN "supplierRecordedAt" TIMESTAMP(3);

-- The client's file lists suppliers newest first, per client.
CREATE INDEX "tasks_clientId_supplierRecordedAt_idx" ON "tasks"("clientId", "supplierRecordedAt");

-- Recurring dates the client is allowed to see. Opt-in per row, exactly
-- like a task: a birthday Ankora tracks for its own reminders is not by
-- itself something the client asked to have shown back to them.
ALTER TABLE "important_dates" ADD COLUMN "clientVisible" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "important_dates_clientId_clientVisible_idx" ON "important_dates"("clientId", "clientVisible");

-- Service preferences. Free text on purpose: these are the answers to the
-- three questions the intake call already asks, in the client's own
-- words, and an enum would make us throw away the half of each answer
-- that actually matters.
ALTER TABLE "clients" ADD COLUMN "preferenceContact" TEXT;
ALTER TABLE "clients" ADD COLUMN "preferenceMatters" TEXT;
ALTER TABLE "clients" ADD COLUMN "preferenceNever" TEXT;
ALTER TABLE "clients" ADD COLUMN "preferencesUpdatedAt" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN "preferencesUpdatedById" TEXT;

ALTER TABLE "clients" ADD CONSTRAINT "clients_preferencesUpdatedById_fkey"
  FOREIGN KEY ("preferencesUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- How often this client wants to hear from the portal. Theirs to set,
-- from their own screen.
CREATE TYPE "PortalDigest" AS ENUM ('EVERY_DECISION', 'WEEKLY', 'MONTHLY');
ALTER TABLE "clients" ADD COLUMN "portalDigest" "PortalDigest" NOT NULL DEFAULT 'EVERY_DECISION';

-- Documents. The row holds a Drive file id and never a URL: the portal
-- serves every download through this server, so a link cannot outlive the
-- permission that granted it (spec section 14, rule 3).
CREATE TYPE "ClientDocumentKind" AS ENUM ('POLICY', 'CERTIFICATE', 'CONTRACT', 'INVOICE', 'OTHER');

CREATE TABLE "client_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "ClientDocumentKind" NOT NULL DEFAULT 'OTHER',
    "driveFileId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "clientVisible" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_documents_clientId_clientVisible_idx" ON "client_documents"("clientId", "clientVisible");

ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The monthly summary, as a record with a signature on it.
--
-- Two rules from the spec live in these columns rather than in a comment:
-- nothing reaches the client without a person approving it (approvedById
-- is required before a summary is readable from the portal), and every
-- sentence traces to a record (sourceTaskIds / sourceDecisionIds are
-- captured when the draft is built, so the approver can check the draft
-- against the rows it came from rather than against their memory).
CREATE TYPE "PortalSummaryStatus" AS ENUM ('DRAFT', 'APPROVED', 'DISCARDED');

CREATE TABLE "portal_summaries" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "draft" TEXT NOT NULL,
    "status" "PortalSummaryStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceTaskIds" TEXT[],
    "sourceDecisionIds" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_summaries_pkey" PRIMARY KEY ("id")
);

-- One summary per client per period. A second generation replaces the
-- draft in place rather than leaving two summaries of the same month for
-- someone to approve the wrong one of.
CREATE UNIQUE INDEX "portal_summaries_clientId_periodStart_key" ON "portal_summaries"("clientId", "periodStart");
CREATE INDEX "portal_summaries_clientId_status_idx" ON "portal_summaries"("clientId", "status");

ALTER TABLE "portal_summaries" ADD CONSTRAINT "portal_summaries_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_summaries" ADD CONSTRAINT "portal_summaries_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
