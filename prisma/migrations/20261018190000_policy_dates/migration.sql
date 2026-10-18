-- Spec 3.11: when a client's rule starts to bind, and when it is reviewed.
ALTER TABLE "client_policies" ADD COLUMN "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "client_policies" ADD COLUMN "reviewBy" TIMESTAMP(3);
