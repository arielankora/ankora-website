-- Claude usage measurement, way 3 (17.11.2026): readings of each person's
-- five-hour and weekly usage limits from the Ankora browser extension.

CREATE TABLE "claude_limit_samples" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "fiveHourPct" DOUBLE PRECISION,
    "fiveHourResetsAt" TIMESTAMP(3),
    "sevenDayPct" DOUBLE PRECISION,
    "sevenDayResetsAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL,
    "extensionVersion" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claude_limit_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "claude_limit_samples_observedAt_idx" ON "claude_limit_samples"("observedAt");
CREATE INDEX "claude_limit_samples_userId_observedAt_idx" ON "claude_limit_samples"("userId", "observedAt");

ALTER TABLE "claude_limit_samples" ADD CONSTRAINT "claude_limit_samples_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
