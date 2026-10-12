-- 12.10.2026: short-lived addresses through which Claude uploads a document
-- to a client's file, or downloads one to read it, over the MCP server
-- (start_document_upload, read_document). New table, no foreign keys,
-- nothing existing is touched.
CREATE TABLE "mcp_file_tickets" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT,
    "taskId" TEXT,
    "title" TEXT,
    "kind" "ClientDocumentKind",
    "fileName" TEXT,
    "mimeType" TEXT,
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_file_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_file_tickets_tokenHash_key" ON "mcp_file_tickets"("tokenHash");
CREATE INDEX "mcp_file_tickets_expiresAt_idx" ON "mcp_file_tickets"("expiresAt");
