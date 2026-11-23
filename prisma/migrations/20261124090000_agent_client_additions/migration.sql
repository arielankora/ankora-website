-- Agents (24.11.2026): a client's additions to an agent get versions of
-- their own (AgentClientAddition), so editing one client's rule does not
-- bump the agent's version for everyone. See prisma/schema.prisma.

-- CreateTable
CREATE TABLE "agent_client_additions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "AgentVersionState" NOT NULL DEFAULT 'DRAFT',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "agent_client_additions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_client_additions_agentId_clientId_version_key" ON "agent_client_additions"("agentId", "clientId", "version");

-- CreateIndex
CREATE INDEX "agent_client_additions_state_idx" ON "agent_client_additions"("state");

-- One open draft (DRAFT or PENDING) per agent and client.
CREATE UNIQUE INDEX "agent_client_additions_one_open" ON "agent_client_additions"("agentId", "clientId") WHERE "state" IN ('DRAFT', 'PENDING');

-- AddForeignKey
ALTER TABLE "agent_client_additions" ADD CONSTRAINT "agent_client_additions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_client_additions" ADD CONSTRAINT "agent_client_additions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: the client blocks of each agent's version in use become version 1
-- of that client's addition, approved (they were approved with the
-- version). Library links (sharedKey, sharedVersion) stay on the blocks.
WITH current AS (
  SELECT DISTINCT ON (v."agentId") v."agentId", v."blocks"
  FROM "agent_versions" v
  WHERE v."state" = 'APPROVED' AND v."faultyAt" IS NULL
  ORDER BY v."agentId", v."version" DESC
),
legacy AS (
  SELECT c."agentId", e.b->>'clientId' AS "clientId", jsonb_agg(e.b - 'clientId' ORDER BY e.ord) AS "blocks"
  FROM current c, jsonb_array_elements(c."blocks") WITH ORDINALITY AS e(b, ord)
  WHERE COALESCE(e.b->>'clientId', '') <> ''
  GROUP BY c."agentId", e.b->>'clientId'
)
INSERT INTO "agent_client_additions" ("id", "agentId", "clientId", "version", "state", "blocks", "changeNote", "submittedAt", "decidedAt")
SELECT 'aca' || md5(l."agentId" || ':' || l."clientId"), l."agentId", l."clientId", 1, 'APPROVED', l."blocks",
       'הועבר מגרסת הסוכן: לתוספת ללקוח יש מעכשיו גרסאות משלה.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM legacy l
JOIN "clients" cl ON cl."id" = l."clientId";

-- An open agent draft whose client blocks differ from what was just
-- approved keeps that change as a draft of the client's addition.
WITH open AS (
  SELECT v."agentId", v."blocks" FROM "agent_versions" v WHERE v."state" IN ('DRAFT', 'PENDING')
),
legacy AS (
  SELECT o."agentId", e.b->>'clientId' AS "clientId", jsonb_agg(e.b - 'clientId' ORDER BY e.ord) AS "blocks"
  FROM open o, jsonb_array_elements(o."blocks") WITH ORDINALITY AS e(b, ord)
  WHERE COALESCE(e.b->>'clientId', '') <> ''
  GROUP BY o."agentId", e.b->>'clientId'
)
INSERT INTO "agent_client_additions" ("id", "agentId", "clientId", "version", "state", "blocks", "changeNote")
SELECT 'acd' || md5(l."agentId" || ':' || l."clientId"), l."agentId", l."clientId", COALESCE(a."version", 0) + 1, 'DRAFT', l."blocks",
       'הועבר מטיוטת הסוכן.'
FROM legacy l
JOIN "clients" cl ON cl."id" = l."clientId"
LEFT JOIN "agent_client_additions" a ON a."agentId" = l."agentId" AND a."clientId" = l."clientId"
WHERE a."blocks" IS DISTINCT FROM l."blocks";

-- Open agent drafts no longer carry client blocks: they live in the
-- additions now. Approved versions stay as they were approved; the
-- compiler skips their client blocks once the client has an addition.
UPDATE "agent_versions" v
SET "blocks" = (
  SELECT COALESCE(jsonb_agg(e.b ORDER BY e.ord), '[]'::jsonb)
  FROM jsonb_array_elements(v."blocks") WITH ORDINALITY AS e(b, ord)
  WHERE COALESCE(e.b->>'clientId', '') = ''
)
WHERE v."state" IN ('DRAFT', 'PENDING')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(v."blocks") AS x(b) WHERE COALESCE(x.b->>'clientId', '') <> '');
