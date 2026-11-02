import "server-only";
import type { CallRecording } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";
import { canSeeCall, type CommsAccess } from "./access";
import { storedCallLine } from "./call-lines";

/// Whether this person may hear (or transcribe) one recording. The full
/// viewers and the call viewers may hear any, including one not stored yet
/// (read live from the mailbox). Anyone else only a stored one that is on
/// their line or with a client they manage. Used by the audio route and by
/// the transcribe button, so neither opens a call the list would hide.
export async function mayHearCall(
  access: CommsAccess,
  viewerId: string,
  stored: Pick<CallRecording, "otherPhone" | "direction" | "fromPhone" | "toPhone"> | null,
): Promise<boolean> {
  if (!access.allowed) return false;
  if (access.allCalls) return true;
  if (!stored) return false;
  const ids = ((await matchPhones([stored.otherPhone])).get(stored.otherPhone)?.clients ?? []).map((c) => c.id);
  const clients = ids.length ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { accountManagerId: true } }) : [];
  return canSeeCall(access, viewerId, clients, storedCallLine(stored));
}
