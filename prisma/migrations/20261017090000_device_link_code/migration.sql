-- 17.10.2026: "add a device". A code shown on a signed-in device lets a
-- new device enrol its own passkey during sign-in.
ALTER TABLE "pending_logins" ADD COLUMN "deviceLinkedAt" TIMESTAMP(3);

CREATE TABLE "device_link_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_link_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_link_codes_userId_key" ON "device_link_codes"("userId");
ALTER TABLE "device_link_codes" ADD CONSTRAINT "device_link_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
