-- 11.10.2026: contact requests from the marketing site, with attribution.
--
-- Until now a request lived only as an email to info@, without any record
-- of how the person reached the site (claude/lead-attribution-gap-2026-10-11.md).
-- New table, no foreign keys, nothing existing is touched.
CREATE TABLE "website_leads" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "areas" TEXT[],
    "message" TEXT,
    "company" TEXT,
    "locale" TEXT,
    "source" TEXT,
    "firstSource" TEXT,
    "landingPage" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "gclid" TEXT,
    "visitNumber" INTEGER,
    "firstSeenAt" TIMESTAMP(3),
    "visitStartedAt" TIMESTAMP(3),
    "gaClientId" TEXT,
    "gaSessionId" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "deviceType" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "userAgent" TEXT,
    "attribution" JSONB,
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "website_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "website_leads_createdAt_idx" ON "website_leads"("createdAt");
CREATE INDEX "website_leads_email_idx" ON "website_leads"("email");
