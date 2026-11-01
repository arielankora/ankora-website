import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { normalizeEmail } from "@/lib/contact-normalize";
import { parseEmailList } from "@/lib/whatsapp-poc/access";
import { parseViewerEmails } from "./visibility";

// Who may open the communications screen (1.11.2026, step 1 of "several
// numbers"). It used to be WHATSAPP_POC_VIEWERS alone (Ariel). Now also:
//   - COMMS_FULL_VIEWERS (Ariel, Hadas), who see every conversation;
//   - the owner of a connected WhatsApp number (Hadas, Anna once theirs are
//     connected), who see their own number;
//   - COMMS_CALL_VIEWERS, who see the Aloha line's recordings (the people
//     who answer it).
// What each of them sees inside is decided per conversation and per call
// (lib/comms/visibility.ts, canSeeCall below). Clients never get in.

export type CommsAccess = {
  allowed: boolean;
  /// Sees every conversation and call (except a number they are excluded from).
  full: boolean;
  /// May approve blocks and connect a number for someone else.
  manager: boolean;
  /// Sees every call recording.
  allCalls: boolean;
  ownedChannelIds: string[];
};

export async function commsAccess(user: Pick<User, "id" | "email" | "role">): Promise<CommsAccess> {
  const none: CommsAccess = { allowed: false, full: false, manager: false, allCalls: false, ownedChannelIds: [] };
  if (user.role === "CLIENT_USER") return none;
  const email = normalizeEmail(user.email);
  if (!email) return none;
  const viewers = parseEmailList(process.env.WHATSAPP_POC_VIEWERS);
  const full = parseViewerEmails(process.env.COMMS_FULL_VIEWERS).includes(email) || viewers.includes(email);
  const callViewer = parseViewerEmails(process.env.COMMS_CALL_VIEWERS).includes(email);
  const owned = (await prisma.commsChannel.findMany({ where: { ownerUserId: user.id }, select: { id: true } })).map((c) => c.id);
  const allowed = full || callViewer || owned.length > 0;
  return { allowed, full, manager: allowed && canManageClients(user.role), allCalls: full || callViewer, ownedChannelIds: owned };
}

/// A call on the Aloha line: the full viewers and the line's people see all
/// of them; anyone else, the calls of clients they manage.
export function canSeeCall(access: CommsAccess, viewerId: string, clients: Array<{ accountManagerId: string | null }>): boolean {
  if (access.allCalls) return true;
  return clients.some((c) => c.accountManagerId === viewerId);
}
