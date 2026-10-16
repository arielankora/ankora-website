-- 16.10.2026: a short upload code typed on /upload replaces the emailed
-- upload link (same table, same tokenHash column), and an uploaded PDF
-- is marked when it has been reviewed, recorded or dismissed.
ALTER TABLE "agreement_sign_links" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "agreement_sign_links" ADD COLUMN "reviewedById" TEXT;
