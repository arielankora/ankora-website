import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { isSafeId, unipileFetch } from "@/lib/whatsapp-poc/recordings";
import { readCallStoreConfig } from "./call-store";
import { mp3DurationSeconds } from "./mp3-duration";
import { manualBatchLine, manualRecordingKey, manualRecordingStart } from "./manual-recordings";

const BASE_URL = "https://api.unipile.com/v2";

type RawAttachment = { id?: unknown; mimetype?: unknown; filename?: unknown; is_inline?: unknown };
type RawEmail = { id?: unknown; subject?: unknown; attachments?: RawAttachment[] | null };

export type ManualImportResult = { emails: number; stored: number; existing: number; failed: number };

/// Imports the hand-sent recording batches in the latest emails of the
/// Aloha mailbox (see lib/comms/manual-recordings.ts). Only a batch whose
/// subject names one of our configured lines is taken, and only its mp3
/// files named after a call time. A manager starts it from the setup
/// screen; running it again stores nothing twice.
///
/// Each call is kept as: from, to and other side all our line, direction
/// unknown. lib/comms/call-lines.ts reads that as "on this line, other
/// side unknown", so the line's owner sees it and no client file does.
/// The audio must reach Drive: there is no way back to it by email id.
export async function importManualRecordings(actorId: string): Promise<ManualImportResult> {
  const { mail, lines, driveFolder } = readCallStoreConfig();
  const result: ManualImportResult = { emails: 0, stored: 0, existing: 0, failed: 0 };
  if (!mail || !driveFolder || lines.length === 0) return result;

  const listUrl = new URL(`${BASE_URL}/${mail.mailAccountId}/emails`);
  listUrl.searchParams.set("limit", "50");
  listUrl.searchParams.set("meta_only", "true");
  const listed = ((await (await unipileFetch(mail.apiKey, listUrl, "application/json")).json()) as { data?: RawEmail[] }).data ?? [];

  for (const email of listed) {
    if (typeof email.id !== "string" || !isSafeId(email.id) || typeof email.subject !== "string") continue;
    const line = manualBatchLine(email.subject);
    if (!line || !lines.includes(line)) continue;
    result.emails += 1;

    for (const a of email.attachments ?? []) {
      if (typeof a.id !== "string" || !isSafeId(a.id) || typeof a.filename !== "string" || a.is_inline === true) continue;
      if (typeof a.mimetype !== "string" || !a.mimetype.startsWith("audio/")) continue;
      const callAt = manualRecordingStart(a.filename);
      if (!callAt) continue;
      const key = manualRecordingKey(email.id, a.filename);
      if (await prisma.callRecording.findUnique({ where: { emailId: key }, select: { id: true } })) {
        result.existing += 1;
        continue;
      }
      const fileUrl = new URL(`${BASE_URL}/${mail.mailAccountId}/emails/${email.id}/attachments/${a.id}`);
      const bytes = await (await unipileFetch(mail.apiKey, fileUrl, "*/*")).arrayBuffer();
      const upload = await uploadLargeFileToDriveFolder({
        name: `${callAt.toISOString().slice(0, 19).replace(/[:T]/g, "-")}_${line.replace(/\D/g, "")}_manual.mp3`,
        mimeType: "audio/mpeg",
        content: Buffer.from(bytes),
        folderId: driveFolder,
      });
      if (!upload.ok || !upload.fileId) {
        result.failed += 1;
        continue;
      }
      await prisma.callRecording.create({
        data: {
          emailId: key,
          mailAccountId: mail.mailAccountId,
          fromPhone: line,
          toPhone: line,
          otherPhone: line,
          direction: "UNKNOWN",
          callAt,
          durationSec: mp3DurationSeconds(bytes),
          sizeBytes: bytes.byteLength,
          mimeType: "audio/mpeg",
          driveFileId: upload.fileId,
          transcript: { create: { status: "PENDING" } },
        },
      });
      result.stored += 1;
    }
  }

  await recordAudit({ actorId, action: "call_recording.manual_import", entityType: "CallRecording", entityId: null, after: result });
  return result;
}
