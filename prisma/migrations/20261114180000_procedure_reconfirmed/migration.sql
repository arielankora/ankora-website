-- "המסמך עדיין נכון": the approved document reconfirmed after a change.
ALTER TABLE "process_versions" ADD COLUMN "reconfirmedAt" TIMESTAMP(3);
ALTER TABLE "process_versions" ADD COLUMN "reconfirmedById" TEXT;
