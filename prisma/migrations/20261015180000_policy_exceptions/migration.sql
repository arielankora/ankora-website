-- 15.10.2026: exceptions to a client's rules, and who approves them and
-- sensitive information (org-brain spec 3.11, 7.2, decision 5).
ALTER TABLE "users" ADD COLUMN "canApproveExceptions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN "ruleApproverIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Decision 5 names Ariel. Hadas is given it on her user page.
UPDATE "users" SET "canApproveExceptions" = true WHERE "email" = 'ariel@ankora.co.il';

CREATE TYPE "PolicyExceptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "policy_exceptions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "PolicyExceptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "policy_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "policy_exceptions_clientId_status_idx" ON "policy_exceptions"("clientId", "status");
CREATE INDEX "policy_exceptions_policyId_idx" ON "policy_exceptions"("policyId");
ALTER TABLE "policy_exceptions" ADD CONSTRAINT "policy_exceptions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_exceptions" ADD CONSTRAINT "policy_exceptions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "client_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
