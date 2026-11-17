-- Claude usage measurement (17.11.2026): every call to the staff MCP
-- connector and every prompt Ankora copies for Claude, as sizes and timings
-- only. See the models in prisma/schema.prisma.

CREATE TABLE "mcp_tool_calls" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "resultBytes" INTEGER NOT NULL,
    "resultChars" INTEGER NOT NULL,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "argsHash" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "claude_prompt_copies" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "chars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claude_prompt_copies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_tool_calls_createdAt_idx" ON "mcp_tool_calls"("createdAt");
CREATE INDEX "mcp_tool_calls_userId_createdAt_idx" ON "mcp_tool_calls"("userId", "createdAt");
CREATE INDEX "mcp_tool_calls_tool_createdAt_idx" ON "mcp_tool_calls"("tool", "createdAt");
CREATE INDEX "claude_prompt_copies_createdAt_idx" ON "claude_prompt_copies"("createdAt");
CREATE INDEX "claude_prompt_copies_userId_createdAt_idx" ON "claude_prompt_copies"("userId", "createdAt");

ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "claude_prompt_copies" ADD CONSTRAINT "claude_prompt_copies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
