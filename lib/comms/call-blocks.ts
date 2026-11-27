import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/contact-normalize";
import { removeDriveFileOrQueue } from "@/lib/comms/drive-deletions";
import { lineOwnerEmails } from "./grants";
import { buildCallBlockIndex, linesOf, type CallBlockIndex } from "./call-block-rules";

// Blocks on call recordings: the database side of lib/comms/call-block-rules.ts.

/// line -> owner's user id (active users only).
export async function lineOwnerIds(): Promise<Map<string, string>> {
  const emails = await lineOwnerEmails();
  const wanted = [...new Set([...emails.values()].map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e)))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { email: { in: wanted, mode: "insensitive" }, deletedAt: null },
    select: { id: true, email: true },
  });
  const idByEmail = new Map(users.map((u) => [normalizeEmail(u.email) ?? u.email, u.id]));
  const out = new Map<string, string>();
  for (const [line, email] of emails) {
    const id = idByEmail.get(normalizeEmail(email) ?? email);
    if (id) out.set(line, id);
  }
  return out;
}

/// Every phone block in force or waiting, by the owner of the number it is on.
export async function loadCallBlockIndex(): Promise<CallBlockIndex> {
  const ownerByLine = await lineOwnerIds();
  if (ownerByLine.size === 0) return buildCallBlockIndex(ownerByLine, []);
  const blocks = await prisma.commsBlock.findMany({
    where: { kind: "PHONE", status: { in: ["PENDING", "APPROVED"] }, channel: { ownerUserId: { in: [...new Set(ownerByLine.values())] } } },
    select: { value: true, status: true, channel: { select: { ownerUserId: true } } },
  });
  return buildCallBlockIndex(
    ownerByLine,
    blocks.map((b) => ({ ownerUserId: b.channel.ownerUserId, phone: b.value, status: b.status as "PENDING" | "APPROVED" })),
  );
}

/// A block came into force on `ownerUserId`'s WhatsApp: the calls with that
/// number on their lines go, audio and transcript, and their emails are
/// marked handled so the nightly reconcile does not store them again.
export async function purgeBlockedCalls(ownerUserId: string, phone: string): Promise<number> {
  const lines = linesOf(await lineOwnerIds(), ownerUserId);
  if (lines.length === 0) return 0;
  const calls = await prisma.callRecording.findMany({
    where: { otherPhone: phone, OR: [{ fromPhone: { in: lines } }, { toPhone: { in: lines } }] },
    select: { id: true, emailId: true, driveFileId: true, fromPhone: true, toPhone: true },
  });
  // A hand-sent recording has our line on both sides and no other number.
  const doomed = calls.filter((c) => c.fromPhone !== c.toPhone);
  if (doomed.length === 0) return 0;
  for (const c of doomed) if (c.driveFileId) await removeDriveFileOrQueue(c.driveFileId, "call-block");
  await prisma.callRecording.deleteMany({ where: { id: { in: doomed.map((c) => c.id) } } });
  await prisma.callRecordingSkip.createMany({ data: doomed.map((c) => ({ emailId: c.emailId })), skipDuplicates: true });
  return doomed.length;
}
