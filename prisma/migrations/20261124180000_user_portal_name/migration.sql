-- Portal (24.11.2026, Hadas): the name and grammatical gender a client
-- reads for their account manager. Both optional.

-- CreateEnum
CREATE TYPE "PortalGender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "portalName" TEXT,
ADD COLUMN     "portalGender" "PortalGender";
