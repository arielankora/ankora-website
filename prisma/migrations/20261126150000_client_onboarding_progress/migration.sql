-- New-client wizard, part two (26.11.2026): where a setup stands, the
-- confirmation that a client has no rules of its own, and when it was
-- activated. All optional, so existing clients are untouched.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "noSpecialRulesAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" INTEGER;
