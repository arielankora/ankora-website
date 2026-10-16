-- 16.10.2026: a personal link to upload the signed agreement PDF, on the
-- same table as the one-time sign links.
CREATE TYPE "AgreementLinkPurpose" AS ENUM ('APP_SIGN', 'PDF_UPLOAD');
ALTER TABLE "agreement_sign_links" ADD COLUMN "purpose" "AgreementLinkPurpose" NOT NULL DEFAULT 'APP_SIGN';
ALTER TABLE "agreement_sign_links" ADD COLUMN "documentId" TEXT;
