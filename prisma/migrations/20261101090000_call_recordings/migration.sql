-- 1.11.2026: communications storage, stage 2. The Aloha line's call
-- recordings and their transcripts, kept here instead of read live from the
-- mailbox. See the comment above CallRecording in schema.prisma.
CREATE TYPE "CallDirection" AS ENUM ('IN', 'OUT', 'UNKNOWN');
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');

CREATE TABLE "call_recordings" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "mailAccountId" TEXT NOT NULL,
    "fromPhone" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "otherPhone" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "callAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "sizeBytes" INTEGER,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "driveFileId" TEXT,
    "audioDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "model" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_recordings_emailId_key" ON "call_recordings"("emailId");
CREATE INDEX "call_recordings_otherPhone_callAt_idx" ON "call_recordings"("otherPhone", "callAt");
CREATE INDEX "call_recordings_callAt_idx" ON "call_recordings"("callAt");
CREATE UNIQUE INDEX "transcripts_recordingId_key" ON "transcripts"("recordingId");
CREATE INDEX "transcripts_status_createdAt_idx" ON "transcripts"("status", "createdAt");

ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "call_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
