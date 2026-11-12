import "server-only";
import type { CommsAccessLevel, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/app-auth/permissions";
import { normalizeEmail } from "@/lib/contact-normalize";
import { parseEmailList } from "@/lib/whatsapp-poc/access";
import { linesOwnedBy } from "./call-lines";
import { callViewerEmails, fullViewerEmails, lineOwnerEmails } from "./grants";

// Who may open the communications screen (1.11.2026, step 1 of "several
// numbers"). It used to be WHATSAPP_POC_VIEWERS alone (Ariel). Now also:
//   - COMMS_FULL_VIEWERS (Ariel, Hadas), who see every conversation;
//   - the owner of a connected WhatsApp number (Hadas, Anna once theirs are
//     connected), who see their own number;
//   - COMMS_CALL_VIEWERS, who see the Aloha line's recordings (the people
//     who answer it).
// What each of them sees inside is decided per conversation and per call
// (lib/comms/visibility.ts, canSeeCall below). Clients never get in.
//
// 12.11.2026: access is given in the app now, on the person's page
// (User.commsAccessLevel, and the owner of each Aloha line). The lists
// above still count, read together with the app in lib/comms/grants.ts.
// OWN opens the screen without a number or a line of their own, so a new
// person can get in and connect theirs.

export type CommsAccess = {
  allowed: boolean;
  /// Sees every conversation and call (except a number they are excluded from).
  full: boolean;
  /// May approve blocks and connect a number for someone else.
  manager: boolean;
  /// Sees every call recording.
  allCalls: boolean;
  ownedChannelIds: string[];
  /// Aloha lines that are this person's (lib/comms/grants.ts): every call on
  /// them is theirs to see.
  ownedLines?: string[];
};

export async function commsAccess(
  user: Pick<User, "id" | "email" | "role"> & { commsAccessLevel?: CommsAccessLevel },
): Promise<CommsAccess> {
  const none: CommsAccess = { allowed: false, full: false, manager: false, allCalls: false, ownedChannelIds: [], ownedLines: [] };
  if (user.role === "CLIENT_USER") return none;
  const email = normalizeEmail(user.email);
  if (!email) return none;
  const viewers = parseEmailList(process.env.WHATSAPP_POC_VIEWERS);
  const [fullList, callList, lineOwners, level] = await Promise.all([
    fullViewerEmails(),
    callViewerEmails(),
    lineOwnerEmails(),
    user.commsAccessLevel ??
      prisma.user.findUnique({ where: { id: user.id }, select: { commsAccessLevel: true } }).then((u) => u?.commsAccessLevel ?? "NONE"),
  ]);
  const full = fullList.includes(email) || viewers.includes(email);
  const callViewer = callList.includes(email);
  const owned = (await prisma.commsChannel.findMany({ where: { ownerUserId: user.id }, select: { id: true } })).map((c) => c.id);
  const ownedLines = linesOwnedBy(lineOwners, email);
  const allowed = full || callViewer || level !== "NONE" || owned.length > 0 || ownedLines.length > 0;
  return { allowed, full, manager: allowed && canManageClients(user.role), allCalls: full || callViewer, ownedChannelIds: owned, ownedLines };
}

/// A call on the Aloha line: the full viewers and the call viewers see all
/// of them; a line's owner, every call on their line; anyone else, the
/// calls of clients they manage.
export function canSeeCall(
  access: CommsAccess,
  viewerId: string,
  clients: Array<{ accountManagerId: string | null }>,
  line: string | null = null,
): boolean {
  if (access.allCalls) return true;
  if (line && access.ownedLines?.includes(line)) return true;
  return clients.some((c) => c.accountManagerId === viewerId);
}
