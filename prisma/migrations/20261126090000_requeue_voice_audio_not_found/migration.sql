-- 26.11.2026: voice messages whose audio was "not found" because it was
-- over the old 25MB ceiling in lib/whatsapp-poc/voice-notes.ts (a 35:52
-- voice message from 24.11 used up its three tries). That ceiling is
-- raised and long audio is now split before transcription, so they go
-- back to the queue for the nightly run, with their tries reset. A voice
-- message whose audio is truly gone fails again, now with its reason in
-- the log. Calls are left as they were.
UPDATE "transcripts"
SET "status" = 'PENDING', "attempts" = 0, "lastError" = NULL, "updatedAt" = NOW()
WHERE "attachmentId" IS NOT NULL
  AND "status" IN ('PENDING', 'FAILED')
  AND "lastError" = 'קובץ השמע לא נמצא.';
