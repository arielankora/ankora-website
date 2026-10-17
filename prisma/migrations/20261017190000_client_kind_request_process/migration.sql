-- Org brain (spec 3.3, 3.7): a client is a business or a private person,
-- with a few words on what they do; a request type can say which process
-- it sets off.
CREATE TYPE "ClientKind" AS ENUM ('BUSINESS', 'PRIVATE');
ALTER TABLE "clients" ADD COLUMN "kind" "ClientKind" NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "clients" ADD COLUMN "industry" TEXT;

ALTER TABLE "request_types" ADD COLUMN "processId" TEXT;
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
