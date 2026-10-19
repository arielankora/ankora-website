-- Spec 3.10: a date on which something is due to reach us from outside.
ALTER TABLE "important_dates" ADD COLUMN "expectsReceipt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "important_dates" ADD COLUMN "expectedFrom" TEXT;
