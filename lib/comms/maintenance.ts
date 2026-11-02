import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { removeDriveFile, uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { callSide, fetchRecordingAudio } from "@/lib/whatsapp-poc/recordings";
import { UnipileError } from "@/lib/whatsapp-poc/unipile";
import { readCallStoreConfig } from "./call-store";
import { copyVoiceToDrive } from "./whatsapp-store";

// Communications storage, nightly upkeep (1.11.2026):
//   - copies to Drive that failed on arrival are made again;
//   - 30 days after a client's engagement ends, what was kept of its people
//     is removed (spec "שמירת שיחות, הקלטות ותמלולים": "בסיום ההתקשרות
//     הלקוח יכול לקבל ייצוא בתוך 30 יום, ואחר כך הכל נמחק").

const DAY_MS = 24 * 60 * 60 * 1000;
export const ENGAGEMENT_END_GRACE_DAYS = 30;

/// Calls stored before their line was configured (2.11.2026: Anna's line
/// joined Hadas's) carry no direction, and their "other side" may be our
/// own number. Once the line is listed in ALOHA_LINE_NUMBER, they are put
/// right: the direction, and the real other side, which the list, the
/// client match and the line owner's view all read.
export async function repairCallLines(lines: readonly string[] = readCallStoreConfig().lines): Promise<{ repaired: number }> {
  if (lines.length === 0) return { repaired: 0 };
  const unknown = await prisma.callRecording.findMany({
    where: { direction: "UNKNOWN", OR: [{ fromPhone: { in: [...lines] } }, { toPhone: { in: [...lines] } }] },
    select: { id: true, fromPhone: true, toPhone: true },
    take: 1000,
  });
  // A hand-sent recording (both numbers our line) has no other side to find.
  const fixable = unknown.filter((rec) => rec.fromPhone !== rec.toPhone);
  for (const rec of fixable) {
    const side = callSide({ from: rec.fromPhone, to: rec.toPhone, callAt: "" }, lines);
    await prisma.callRecording.update({
      where: { id: rec.id },
      data: { direction: side.direction === "in" ? "IN" : "OUT", otherPhone: side.other },
    });
  }
  return { repaired: fixable.length };
}

/// Recordings and voice messages stored without their Drive copy (Drive
/// was down, or the folder was not set yet). Their audio is still in the
/// mailbox or at Unipile, so it is copied now.
export async function completeDriveCopies(options: { budgetMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const start = now();
  const { mail, driveFolder } = readCallStoreConfig();
  const result = { recordings: 0, voice: 0 };
  if (!driveFolder) return result;

  if (mail) {
    const missing = await prisma.callRecording.findMany({
      where: { driveFileId: null, audioDeletedAt: null },
      orderBy: { callAt: "desc" },
      take: 30,
      select: { id: true, emailId: true, otherPhone: true, callAt: true },
    });
    for (const rec of missing) {
      if (now() - start > options.budgetMs) return result;
      try {
        const audio = await fetchRecordingAudio(mail, rec.emailId);
        if (!audio) continue;
        const upload = await uploadLargeFileToDriveFolder({
          name: `${rec.callAt.toISOString().slice(0, 19).replace(/[:T]/g, "-")}_${rec.otherPhone.replace(/\D/g, "")}.mp3`,
          mimeType: audio.contentType,
          content: Buffer.from(audio.bytes),
          folderId: driveFolder,
        });
        if (upload.ok && upload.fileId) {
          await prisma.callRecording.update({ where: { id: rec.id }, data: { driveFileId: upload.fileId } });
          result.recordings += 1;
        }
      } catch (err) {
        if (err instanceof UnipileError && err.status === 429) return result;
        if (!(err instanceof UnipileError)) throw err;
      }
    }
  }

  const voice = await prisma.commsAttachment.findMany({
    where: { type: "audio", driveFileId: null, message: { held: false } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, message: { select: { externalId: true, conversation: { select: { externalChatId: true, channel: true } } } } },
  });
  for (const a of voice) {
    if (now() - start > options.budgetMs) return result;
    await copyVoiceToDrive(a.message.conversation.channel, a.message.conversation.externalChatId, a.message.externalId, a.id);
    const after = await prisma.commsAttachment.findUnique({ where: { id: a.id }, select: { driveFileId: true } });
    if (after?.driveFileId) result.voice += 1;
  }
  return result;
}

/// Clients archived more than 30 days ago (archiving sets deletedAt): what
/// was kept of their people is removed, unless the same number belongs to
/// someone in the file of a client still with us. Groups assigned to them
/// are removed too.
export async function sweepEndedEngagements(now = new Date()) {
  const cutoff = new Date(now.getTime() - ENGAGEMENT_END_GRACE_DAYS * DAY_MS);
  const ended = await prisma.client.findMany({
    where: { status: "ARCHIVED", deletedAt: { lt: cutoff } },
    select: { id: true },
  });
  const report = { clients: 0, recordings: 0, conversations: 0 };
  for (const client of ended) {
    const people = await prisma.clientContact.findMany({ where: { clientId: client.id }, select: { person: { select: { phones: true } } } });
    const phones = [...new Set(people.flatMap((p) => p.person.phones))];
    // A number also in a current client's file stays.
    const kept = phones.length
      ? new Set(
          (
            await prisma.person.findMany({
              where: {
                phones: { hasSome: phones },
                deletedAt: null,
                contacts: { some: { deletedAt: null, client: { status: { not: "ARCHIVED" } } } },
              },
              select: { phones: true },
            })
          ).flatMap((p) => p.phones),
        )
      : new Set<string>();
    const doomed = phones.filter((p) => !kept.has(p));

    const recordings = await prisma.callRecording.findMany({ where: { otherPhone: { in: doomed } }, select: { id: true, driveFileId: true } });
    const conversations = await prisma.commsConversation.findMany({
      where: { OR: [{ otherPhone: { in: doomed } }, { groupClientId: client.id }] },
      select: { id: true },
    });
    if (recordings.length === 0 && conversations.length === 0) continue;

    for (const r of recordings) if (r.driveFileId) await removeDriveFile(r.driveFileId);
    const voiceFiles = await prisma.commsAttachment.findMany({
      where: { driveFileId: { not: null }, message: { conversationId: { in: conversations.map((c) => c.id) } } },
      select: { driveFileId: true },
    });
    for (const f of voiceFiles) await removeDriveFile(f.driveFileId!);
    await prisma.callRecording.deleteMany({ where: { id: { in: recordings.map((r) => r.id) } } });
    await prisma.commsConversation.deleteMany({ where: { id: { in: conversations.map((c) => c.id) } } });

    report.clients += 1;
    report.recordings += recordings.length;
    report.conversations += conversations.length;
    await recordAudit({
      actorId: null,
      action: "comms_engagement_end.sweep",
      entityType: "CommsConversation",
      entityId: null,
      clientId: client.id,
      after: { recordings: recordings.length, conversations: conversations.length },
    });
  }
  return report;
}
