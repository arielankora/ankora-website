import "server-only";
import { Prisma, type CommsChannel, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { canManageClients } from "@/lib/app-auth/permissions";
import { maskPhone } from "@/lib/whatsapp-poc/access";
import { removeDriveFile, uploadLargeFileToDriveFolder } from "@/lib/google-drive";
import { chatPhone } from "@/lib/whatsapp-poc/inbox";
import {
  UnipileError,
  getChat,
  isHiddenChat,
  listMessages,
  loadMergedChats,
  toPocMessage,
  type PocChat,
  type PocMessage,
} from "@/lib/whatsapp-poc/unipile";
import { fetchVoiceNote } from "@/lib/whatsapp-poc/voice-notes";
import { isAiExcludedNumber } from "./call-store";
import { blockStateFor } from "./visibility";

// Communications storage, stage 3 (1.11.2026, spec "שמירת שיחות, הקלטות
// ותמלולים", approved by Ariel). WhatsApp messages of every connected
// number are kept here, except those on the number's block list:
//   - nothing is kept for a number until its owner has gone through the
//     block list and pressed "התחל לשמור" (CommsChannel.storeEnabled);
//   - a new message arrives by Unipile's message.new webhook; edits and
//     deletions by message.update and message.delete;
//   - a blocked number or group is dropped on arrival, and a block a
//     manager approves deletes what was kept from it;
//   - a block an employee asks for holds the messages (kept, shown to
//     nobody, not transcribed) until a manager decides;
//   - voice messages are copied to Drive and transcribed, unless the
//     number belongs to a client marked "בלי AI".

type Unipile = { apiKey: string; accountId: string };

function unipileFor(channel: Pick<CommsChannel, "accountId">): Unipile | null {
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  return apiKey ? { apiKey, accountId: channel.accountId } : null;
}

function driveFolder(): string | null {
  return process.env.GOOGLE_DRIVE_FOLDER_CALL_RECORDINGS?.trim() || null;
}

async function blocksOf(channelId: string) {
  return prisma.commsBlock.findMany({ where: { channelId }, select: { kind: true, value: true, status: true } });
}

/// The conversation row for a Unipile chat, created on first sight. A chat
/// is read from Unipile only then, to learn its number, name and kind.
async function conversationFor(channel: CommsChannel, chatId: string, known?: PocChat | null) {
  const existing = await prisma.commsConversation.findUnique({
    where: { channelId_externalChatId: { channelId: channel.id, externalChatId: chatId } },
  });
  if (existing) return existing;
  const unipile = unipileFor(channel);
  const chat = known ?? (unipile ? await getChat(unipile, chatId) : null);
  if (!chat || isHiddenChat(chat)) return null;
  try {
    return await prisma.commsConversation.create({
      data: {
        channelId: channel.id,
        externalChatId: chatId,
        isGroup: chat.type === "group",
        otherPhone: chatPhone(chat),
        name: chat.name,
        lastMessageAt: chat.lastMessageAt ? new Date(chat.lastMessageAt) : null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.commsConversation.findUnique({
        where: { channelId_externalChatId: { channelId: channel.id, externalChatId: chatId } },
      });
    }
    throw err;
  }
}

export type IngestResult = "stored" | "exists" | "blocked" | "not-stored" | "skipped";

/// Keep one message. `chatId` is Unipile's chat id; the message is already
/// in our shape (toPocMessage).
export async function storeMessage(
  channel: CommsChannel,
  chatId: string,
  m: PocMessage,
  options: { knownChat?: PocChat | null; transcribe?: (transcriptId: string) => Promise<unknown> } = {},
): Promise<IngestResult> {
  if (!channel.storeEnabled) return "not-stored";
  const conversation = await conversationFor(channel, chatId, options.knownChat);
  if (!conversation) return "skipped";
  const state = blockStateFor(await blocksOf(channel.id), { phone: conversation.otherPhone, chatId });
  if (state === "blocked") return "blocked";
  const held = state === "pending";

  const exists = await prisma.commsMessage.findUnique({
    where: { conversationId_externalId: { conversationId: conversation.id, externalId: m.id } },
    select: { id: true },
  });
  if (exists) return "exists";

  const skipTranscript = !conversation.otherPhone ? false : await isAiExcludedNumber(conversation.otherPhone);
  let created;
  try {
    created = await prisma.commsMessage.create({
      data: {
        conversationId: conversation.id,
        externalId: m.id,
        at: new Date(m.timestamp),
        isSender: m.isSender,
        senderName: m.senderName,
        text: m.text,
        isDeleted: m.isDeleted,
        held,
        attachments: {
          create: m.attachments
            .filter((a) => a.id)
            .map((a) => ({
              externalId: a.id!,
              type: a.type,
              mimetype: a.mimetype,
              voiceNote: a.voiceNote,
              durationSec: a.duration ? Math.round(a.duration) : null,
              transcript: a.type === "audio" ? { create: { status: skipTranscript ? "SKIPPED" : "PENDING" } } : undefined,
            })),
        },
      },
      include: { attachments: { include: { transcript: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "exists";
    throw err;
  }
  const at = new Date(m.timestamp);
  if (!conversation.lastMessageAt || at > conversation.lastMessageAt) {
    await prisma.commsConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: at } });
  }

  // Voice messages: a copy in Drive, then the transcript (not while held).
  for (const a of created.attachments) {
    if (a.type !== "audio") continue;
    await copyVoiceToDrive(channel, chatId, m.id, a.id);
    if (!held && a.transcript?.status === "PENDING" && options.transcribe) await options.transcribe(a.transcript.id);
  }
  return "stored";
}

async function copyVoiceToDrive(channel: CommsChannel, chatId: string, messageId: string, attachmentId: string) {
  const folder = driveFolder();
  const unipile = unipileFor(channel);
  if (!folder || !unipile) return;
  try {
    const audio = await fetchVoiceNote(unipile, chatId, messageId);
    if (!audio) return;
    const upload = await uploadLargeFileToDriveFolder({
      name: `whatsapp_${messageId}.ogg`,
      mimeType: audio.contentType,
      content: Buffer.from(audio.bytes),
      folderId: folder,
    });
    if (upload.ok && upload.fileId) {
      await prisma.commsAttachment.update({ where: { id: attachmentId }, data: { driveFileId: upload.fileId } });
    }
  } catch (err) {
    // The audio stays reachable through Unipile; the copy is retried by
    // nothing, and the player falls back to Unipile.
    if (!(err instanceof UnipileError)) throw err;
  }
}

/// message.update: the text changed, or it was deleted for everyone.
export async function updateStoredMessage(channel: CommsChannel, chatId: string, m: PocMessage): Promise<boolean> {
  const conversation = await prisma.commsConversation.findUnique({
    where: { channelId_externalChatId: { channelId: channel.id, externalChatId: chatId } },
  });
  if (!conversation) return false;
  const { count } = await prisma.commsMessage.updateMany({
    where: { conversationId: conversation.id, externalId: m.id },
    data: { text: m.text, isDeleted: m.isDeleted, isEdited: true },
  });
  return count > 0;
}

/// message.delete. The text is cleared, not only flagged: what was deleted
/// in WhatsApp is not kept here.
export async function deleteStoredMessage(channel: CommsChannel, chatId: string, messageId: string): Promise<boolean> {
  const conversation = await prisma.commsConversation.findUnique({
    where: { channelId_externalChatId: { channelId: channel.id, externalChatId: chatId } },
  });
  if (!conversation) return false;
  const { count } = await prisma.commsMessage.updateMany({
    where: { conversationId: conversation.id, externalId: messageId },
    data: { text: "", isDeleted: true },
  });
  return count > 0;
}

/// Everything kept from a number (or a group) on one channel, gone: the
/// rows, their transcripts (cascade), and the Drive copies.
async function purge(channelId: string, target: { kind: "PHONE" | "CHAT"; value: string }) {
  const where =
    target.kind === "PHONE" ? { channelId, otherPhone: target.value } : { channelId, externalChatId: target.value };
  const conversations = await prisma.commsConversation.findMany({ where, select: { id: true } });
  const ids = conversations.map((c) => c.id);
  if (ids.length === 0) return 0;
  const files = await prisma.commsAttachment.findMany({
    where: { message: { conversationId: { in: ids } }, driveFileId: { not: null } },
    select: { driveFileId: true },
  });
  for (const f of files) await removeDriveFile(f.driveFileId!);
  const { count } = await prisma.commsMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.commsConversation.deleteMany({ where: { id: { in: ids } } });
  return count;
}

export class BlockError extends Error {}

type Actor = Pick<User, "id" | "role">;

async function channelOrThrow(channelId: string) {
  const channel = await prisma.commsChannel.findUnique({ where: { id: channelId } });
  if (!channel) throw new BlockError("המספר המחובר לא נמצא.");
  return channel;
}

/// "לא לשמור שיחות עם המספר הזה". A manager's takes effect at once and
/// deletes what was kept; anyone else's holds the messages and waits for
/// a manager.
export async function requestBlock(
  actor: Actor,
  input: { channelId: string; kind: "PHONE" | "CHAT"; value: string; label: string | null },
) {
  const channel = await channelOrThrow(input.channelId);
  const manager = canManageClients(actor.role);
  if (!manager && channel.ownerUserId !== actor.id) throw new BlockError("אפשר לחסום רק מספרים בשיחות של המספר שלך.");

  const status = manager ? "APPROVED" : "PENDING";
  const block = await prisma.commsBlock.upsert({
    where: { channelId_kind_value: { channelId: channel.id, kind: input.kind, value: input.value } },
    create: {
      channelId: channel.id,
      kind: input.kind,
      value: input.value,
      label: input.label,
      status,
      requestedById: actor.id,
      decidedById: manager ? actor.id : null,
      decidedAt: manager ? new Date() : null,
    },
    update: {
      status,
      label: input.label,
      requestedById: actor.id,
      requestedAt: new Date(),
      decidedById: manager ? actor.id : null,
      decidedAt: manager ? new Date() : null,
    },
  });

  let deleted = 0;
  if (manager) deleted = await purge(channel.id, input);
  else await setHeld(channel.id, input, true);

  await recordAudit({
    actorId: actor.id,
    action: manager ? "comms_block.approved" : "comms_block.requested",
    entityType: "CommsBlock",
    entityId: block.id,
    after: { kind: input.kind, value: input.kind === "PHONE" ? maskPhone(input.value) : "group", deletedMessages: deleted },
  });
  return { block, deleted };
}

async function setHeld(channelId: string, target: { kind: "PHONE" | "CHAT"; value: string }, held: boolean) {
  const where =
    target.kind === "PHONE" ? { channelId, otherPhone: target.value } : { channelId, externalChatId: target.value };
  await prisma.commsMessage.updateMany({ where: { conversation: where }, data: { held } });
}

/// A manager answers an employee's request.
export async function decideBlock(actor: Actor, blockId: string, approve: boolean) {
  if (!canManageClients(actor.role)) throw new BlockError("רק מנהל מחליט על חסימה.");
  const block = await prisma.commsBlock.findUnique({ where: { id: blockId } });
  if (!block || block.status !== "PENDING") throw new BlockError("הבקשה כבר טופלה.");
  await prisma.commsBlock.update({
    where: { id: blockId },
    data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date() },
  });
  const deleted = approve ? await purge(block.channelId, block) : 0;
  if (!approve) await setHeld(block.channelId, block, false);
  await recordAudit({
    actorId: actor.id,
    action: approve ? "comms_block.approved" : "comms_block.rejected",
    entityType: "CommsBlock",
    entityId: blockId,
    after: { deletedMessages: deleted },
  });
}

/// Only a manager lifts a block. What was deleted stays deleted.
export async function revokeBlock(actor: Actor, blockId: string) {
  if (!canManageClients(actor.role)) throw new BlockError("רק מנהל מבטל חסימה.");
  const block = await prisma.commsBlock.findUnique({ where: { id: blockId } });
  if (!block || block.status !== "APPROVED") throw new BlockError("החסימה לא פעילה.");
  await prisma.commsBlock.update({ where: { id: blockId }, data: { status: "REVOKED", decidedById: actor.id, decidedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "comms_block.revoked", entityType: "CommsBlock", entityId: blockId });
}

/// The setup screen's "התחל לשמור". Only the number's owner, or a manager.
export async function startStoring(actor: Actor, channelId: string) {
  const channel = await channelOrThrow(channelId);
  if (channel.ownerUserId !== actor.id && !canManageClients(actor.role)) throw new BlockError("אין הרשאה.");
  await prisma.commsChannel.update({ where: { id: channelId }, data: { storeEnabled: true, storeStartedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "comms_channel.store_started", entityType: "CommsChannel", entityId: channelId });
}

/// The first load, a little each night: for each chat in Unipile's list that
/// is not blocked and not loaded yet, its latest 100 messages.
export async function backfillChannel(
  channel: CommsChannel,
  options: { budgetMs: number; now?: () => number; transcribe?: (id: string) => Promise<unknown> },
) {
  const now = options.now ?? Date.now;
  const start = now();
  const unipile = unipileFor(channel);
  const result = { chats: 0, messages: 0, stoppedBy: "done" as "done" | "budget" | "quota" | "not-configured" };
  if (!channel.storeEnabled || !unipile) return { ...result, stoppedBy: "not-configured" as const };

  let chats: PocChat[];
  try {
    chats = (await loadMergedChats(unipile)).chats;
  } catch (err) {
    if (err instanceof UnipileError && err.status === 429) return { ...result, stoppedBy: "quota" as const };
    throw err;
  }
  const blocks = await blocksOf(channel.id);
  const done = new Set(
    (
      await prisma.commsConversation.findMany({
        where: { channelId: channel.id, backfilledAt: { not: null } },
        select: { externalChatId: true },
      })
    ).map((c) => c.externalChatId),
  );
  for (const chat of chats) {
    if (done.has(chat.id)) continue;
    if (blockStateFor(blocks, { phone: chatPhone(chat), chatId: chat.id }) === "blocked") continue;
    if (now() - start > options.budgetMs) return { ...result, stoppedBy: "budget" as const };
    let messages: PocMessage[];
    try {
      messages = await listMessages(unipile, chat.id, 100);
    } catch (err) {
      if (err instanceof UnipileError && err.status === 429) return { ...result, stoppedBy: "quota" as const };
      throw err;
    }
    for (const m of messages) {
      if ((await storeMessage(channel, chat.id, m, { knownChat: chat, transcribe: options.transcribe })) === "stored") result.messages += 1;
    }
    await prisma.commsConversation.updateMany({
      where: { channelId: channel.id, externalChatId: chat.id },
      data: { backfilledAt: new Date() },
    });
    result.chats += 1;
  }
  return result;
}

/// A webhook event body, read into what storeMessage needs.
export function readMessageEvent(payload: unknown): { chatId: string; message: PocMessage | null; messageId: string | null } | null {
  const p = payload as { chat_id?: unknown; id?: unknown } | null;
  if (!p || typeof p.chat_id !== "string" || !p.chat_id) return null;
  return {
    chatId: p.chat_id,
    message: toPocMessage(p as Parameters<typeof toPocMessage>[0]),
    messageId: typeof p.id === "string" ? p.id : null,
  };
}

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/// The retention the spec sets, for WhatsApp: a voice message's audio is
/// removed from Drive after 12 months (the transcript stays), and a
/// conversation that belongs to no client and has been quiet for 12 months
/// is removed entirely.
export async function sweepWhatsappRetention(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const oldAudio = await prisma.commsAttachment.findMany({
    where: { driveFileId: { not: null }, message: { at: { lt: cutoff } } },
    select: { id: true, driveFileId: true },
    take: 200,
  });
  let audioRemoved = 0;
  for (const a of oldAudio) {
    if (!(await removeDriveFile(a.driveFileId!)).ok) continue;
    await prisma.commsAttachment.update({ where: { id: a.id }, data: { driveFileId: null } });
    audioRemoved += 1;
  }

  const quiet = await prisma.commsConversation.findMany({
    where: { lastMessageAt: { lt: cutoff }, groupClientId: null },
    select: { id: true, otherPhone: true },
    take: 500,
  });
  const phones = quiet.map((c) => c.otherPhone).filter((p): p is string => Boolean(p));
  const owned = phones.length
    ? new Set(
        (
          await prisma.person.findMany({
            where: { deletedAt: null, phones: { hasSome: phones }, contacts: { some: { deletedAt: null } } },
            select: { phones: true },
          })
        ).flatMap((p) => p.phones),
      )
    : new Set<string>();
  const doomed = quiet.filter((c) => !c.otherPhone || !owned.has(c.otherPhone)).map((c) => c.id);
  if (doomed.length) {
    const files = await prisma.commsAttachment.findMany({
      where: { message: { conversationId: { in: doomed } }, driveFileId: { not: null } },
      select: { driveFileId: true },
    });
    for (const f of files) await removeDriveFile(f.driveFileId!);
    await prisma.commsConversation.deleteMany({ where: { id: { in: doomed } } });
  }
  if (audioRemoved || doomed.length) {
    await recordAudit({
      actorId: null,
      action: "comms_whatsapp.retention_sweep",
      entityType: "CommsConversation",
      entityId: null,
      after: { audioRemoved, conversationsRemoved: doomed.length },
    });
  }
  return { audioRemoved, conversationsRemoved: doomed.length };
}
