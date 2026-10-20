-- Spec 3.1: every item in a client's file has someone who keeps it right.
-- Items that entered without one are kept by the client's account manager,
-- as new ones are from now on. Clients without an account manager are left as they are.

UPDATE "client_facts" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "client_contacts" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "client_organizations" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "system_access" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "client_entities" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "request_types" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "client_policies" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
UPDATE "processes" AS t SET "ownerId" = c."accountManagerId" FROM "clients" AS c WHERE t."clientId" = c."id" AND t."ownerId" IS NULL AND t."deletedAt" IS NULL AND c."accountManagerId" IS NOT NULL;
