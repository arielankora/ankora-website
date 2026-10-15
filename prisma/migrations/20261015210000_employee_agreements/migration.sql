-- 15.10.2026: employee agreements. A confidentiality undertaking signed
-- before using the app, and a deletion declaration signed on leaving,
-- each recorded with version, content hash, IP and browser.
ALTER TABLE "users" ADD COLUMN "personalEmail" TEXT;

CREATE TYPE "AgreementKind" AS ENUM ('CONFIDENTIALITY', 'DELETION_DECLARATION');
CREATE TYPE "AgreementChannel" AS ENUM ('APP', 'EMAIL_PDF');

CREATE TABLE "employee_agreements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "version" TEXT NOT NULL,
    "channel" "AgreementChannel" NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "signedName" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "contentHash" TEXT NOT NULL,
    "driveFileId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_agreements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_agreements_userId_kind_idx" ON "employee_agreements"("userId", "kind");
ALTER TABLE "employee_agreements" ADD CONSTRAINT "employee_agreements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "agreement_sign_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "version" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agreement_sign_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agreement_sign_links_tokenHash_key" ON "agreement_sign_links"("tokenHash");
CREATE INDEX "agreement_sign_links_userId_idx" ON "agreement_sign_links"("userId");
ALTER TABLE "agreement_sign_links" ADD CONSTRAINT "agreement_sign_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
