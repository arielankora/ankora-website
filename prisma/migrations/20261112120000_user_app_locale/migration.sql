-- The app's interface language, per person (12.11.2026, ADR 0006).
-- Additive only: a new enum and a column whose default keeps every
-- existing person on Hebrew, exactly as they are today.

-- CreateEnum
CREATE TYPE "AppLocale" AS ENUM ('he', 'en');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "locale" "AppLocale" NOT NULL DEFAULT 'he';
