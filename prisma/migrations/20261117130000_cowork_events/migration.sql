-- Claude usage measurement, stage 2 (17.11.2026): Cowork's telemetry
-- events, metadata only. See CoworkEvent in prisma/schema.prisma.

CREATE TABLE "cowork_events" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "accountUuid" TEXT,
    "sessionId" TEXT,
    "promptId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "appVersion" TEXT,
    "model" TEXT,
    "costUsd" DECIMAL(12,6),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheCreationTokens" INTEGER,
    "durationMs" INTEGER,
    "speed" TEXT,
    "statusCode" TEXT,
    "attempt" INTEGER,
    "errorText" TEXT,
    "toolName" TEXT,
    "toolSuccess" BOOLEAN,
    "toolResultBytes" INTEGER,
    "mcpServer" TEXT,
    "mcpTool" TEXT,
    "promptLength" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cowork_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cowork_events_dedupeKey_key" ON "cowork_events"("dedupeKey");
CREATE INDEX "cowork_events_occurredAt_idx" ON "cowork_events"("occurredAt");
CREATE INDEX "cowork_events_userId_occurredAt_idx" ON "cowork_events"("userId", "occurredAt");
CREATE INDEX "cowork_events_eventName_occurredAt_idx" ON "cowork_events"("eventName", "occurredAt");
CREATE INDEX "cowork_events_promptId_idx" ON "cowork_events"("promptId");

ALTER TABLE "cowork_events" ADD CONSTRAINT "cowork_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
