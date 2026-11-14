-- Processes redesign, spec 6.1 (Ariel, 13.11.2026 and 14.11.2026): in
-- Ankora's own file, nine processes are work instructions (how to do a
-- thing right), with no rhythm and no runs; P6 stays a process; P22, a
-- one-off test, is retired. By code within that client. Idempotent.

UPDATE "processes"
SET "kind" = 'GUIDE', "updatedAt" = CURRENT_TIMESTAMP
WHERE "clientId" = 'cmucgdw0r0000id04857t82r7'
  AND "code" IN ('P3', 'P5', 'P7', 'P14', 'P16', 'P17', 'P18', 'P21', 'P24')
  AND "deletedAt" IS NULL
  AND "kind" <> 'GUIDE';

UPDATE "processes"
SET "status" = 'RETIRED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "clientId" = 'cmucgdw0r0000id04857t82r7'
  AND "code" = 'P22'
  AND "deletedAt" IS NULL
  AND "status" <> 'RETIRED';
