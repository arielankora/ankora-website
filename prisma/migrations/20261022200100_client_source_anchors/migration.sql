-- Where a client's material lives outside Ankora: keywords, Drive folder,
-- conversations document (advance with Claude, 22.10.2026).
ALTER TABLE "clients" ADD COLUMN "sourceKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "clients" ADD COLUMN "driveFolderId" TEXT;
ALTER TABLE "clients" ADD COLUMN "conversationsDocId" TEXT;
