-- Recording emails not stored because the number is blocked on the line
-- owner's WhatsApp. Only the email id is kept.
CREATE TABLE "call_recording_skips" (
    "emailId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recording_skips_pkey" PRIMARY KEY ("emailId")
);
