-- Portal phase 2: decisions.
--
-- Additive only. Every existing client gets NULL for the three new
-- columns, which reads as "no account manager recorded, no WhatsApp line
-- recorded, no ceiling agreed" - all of which the product handles
-- explicitly rather than assuming a default.

ALTER TABLE "clients" ADD COLUMN "accountManagerId" TEXT;
ALTER TABLE "clients" ADD COLUMN "whatsappNumber" TEXT;
ALTER TABLE "clients" ADD COLUMN "approvalCeilingMinor" INTEGER;

CREATE INDEX "clients_accountManagerId_idx" ON "clients"("accountManagerId");

ALTER TABLE "clients" ADD CONSTRAINT "clients_accountManagerId_fkey"
  FOREIGN KEY ("accountManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'ANSWERED', 'CANCELLED');

CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taskId" TEXT,
    "question" TEXT NOT NULL,
    "background" TEXT,
    "amountMinor" INTEGER,
    "ceilingMinorAtCreation" INTEGER,
    "dueAt" TIMESTAMP(3),
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decisions_clientId_status_idx" ON "decisions"("clientId", "status");

CREATE TABLE "decision_options" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "amountMinor" INTEGER,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "decision_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_options_decisionId_idx" ON "decision_options"("decisionId");

CREATE TABLE "decision_responses" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "respondedById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionSnapshot" TEXT NOT NULL,
    "optionLabelSnapshot" TEXT NOT NULL,
    "amountMinorSnapshot" INTEGER,

    CONSTRAINT "decision_responses_pkey" PRIMARY KEY ("id")
);

-- One answer per decision: a client who changes their mind gets a new
-- decision, so the record of what they approved stays a record.
CREATE UNIQUE INDEX "decision_responses_decisionId_key" ON "decision_responses"("decisionId");
CREATE INDEX "decision_responses_respondedById_idx" ON "decision_responses"("respondedById");

ALTER TABLE "decisions" ADD CONSTRAINT "decisions_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "decision_options" ADD CONSTRAINT "decision_options_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decision_responses" ADD CONSTRAINT "decision_responses_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_responses" ADD CONSTRAINT "decision_responses_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "decision_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decision_responses" ADD CONSTRAINT "decision_responses_respondedById_fkey"
  FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
