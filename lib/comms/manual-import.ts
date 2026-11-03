import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { isSafeId, unipileFetch } from "@/lib/whatsapp-poc/recordings";
import { readCallStoreConfig } from "./call-store";
import { mp3DurationSeconds } from "./mp3-duration";
import { manualBatchLine, manualRecordingKey, manualRecordingStart } from "./manual-recordings";

const BASE_URL = "https://api.unipile.com/v2";
/// How far back the import looks: 4 pages of 50 emails.
const MAX_PAGES = 4;

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

  // The latest emails, a few pages back (the mailbox gets a dozen recording
  // emails a day). The light listing (meta_only) is enough to find a batch
  // by its subject, but carries no attachments: 3.11.2026, the first import
  // found Aloha's email and stored nothing. So each batch found is read in
  // full before its files are taken.
  const listed: RawEmail[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listUrl = new URL(`${BASE_URL}/${mail.mailAccountId}/emails`);
    listUrl.searchParams.set("limit", "50");
    listUrl.searchParams.set("meta_only", "true");
    if (cursor) listUrl.searchParams.set("cursor", cursor);
    const body = (await (await unipileFetch(mail.apiKey, listUrl, "application/json")).json()) as { data?: RawEmail[]; next_cursor?: unknown };
    listed.push(...(body.data ?? []));
    cursor = typeof body.next_cursor === "string" && body.next_cursor ? body.next_cursor : null;
    if (!cursor) break;
  }

  for (const meta of listed) {
    if (typeof meta.id !== "string" || !isSafeId(meta.id) || typeof meta.subject !== "string") continue;
    const line = manualBatchLine(meta.subject);
    if (!line || !lines.includes(line)) continue;
    result.emails += 1;

    const emailUrl = new URL(`${BASE_URL}/${mail.mailAccountId}/emails/${meta.id}`);
    const email = (await (await unipileFetch(mail.apiKey, emailUrl, "application/json")).json()) as RawEmail;
    if (email.id !== meta.id) continue;

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
  console.log(`comms manual import ${JSON.stringify(result)}`);
  return result;
}
