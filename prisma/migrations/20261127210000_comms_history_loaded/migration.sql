-- When a WhatsApp number's history finished loading (27.11.2026).
ALTER TABLE "comms_channels" ADD COLUMN "historyLoadedAt" TIMESTAMP(3);
