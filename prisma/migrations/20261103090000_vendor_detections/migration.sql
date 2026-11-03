-- P8, 3.11.2026: tasks that look like connecting a new vendor to the product.
CREATE TYPE "VendorDetectionStatus" AS ENUM ('PENDING', 'OPENED', 'NOT_A_VENDOR', 'EXISTING');

CREATE TABLE "vendor_detections" (
    "id" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vendorName" TEXT,
    "vendorSlug" TEXT,
    "matched" TEXT NOT NULL,
    "status" "VendorDetectionStatus" NOT NULL DEFAULT 'PENDING',
    "runTaskId" TEXT,
    "autoOpened" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_detections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_detections_sourceTaskId_key" ON "vendor_detections"("sourceTaskId");
CREATE INDEX "vendor_detections_status_createdAt_idx" ON "vendor_detections"("status", "createdAt");
CREATE INDEX "vendor_detections_vendorSlug_idx" ON "vendor_detections"("vendorSlug");

ALTER TABLE "vendor_detections" ADD CONSTRAINT "vendor_detections_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_detections" ADD CONSTRAINT "vendor_detections_runTaskId_fkey" FOREIGN KEY ("runTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vendor_detections" ADD CONSTRAINT "vendor_detections_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
