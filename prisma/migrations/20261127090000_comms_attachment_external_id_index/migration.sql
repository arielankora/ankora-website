-- 27.11.2026: the same voice message stored on two of our numbers is found
-- by its attachment id, so it is transcribed once (lib/comms/call-store.ts).
CREATE INDEX "comms_attachments_externalId_idx" ON "comms_attachments"("externalId");
