-- 14.10.2026: Ankora's extraction guidance for Claude, in versions
-- (org-brain decision 3). New table only.
CREATE TYPE "GuideState" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

CREATE TABLE "extraction_guides" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "note" TEXT,
    "state" "GuideState" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    CONSTRAINT "extraction_guides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "extraction_guides_version_key" ON "extraction_guides"("version");
