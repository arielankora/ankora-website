import { normalizeEmail } from "@/lib/contact-normalize";

// Who sees which WhatsApp conversation (spec "שמירת שיחות, הקלטות ותמלולים",
// decisions of 1.11.2026). Pure, so it is tested without a database.
//
//   - Someone excluded from a number never sees its conversations (Hadas
//     and Ariel's number: not even with her own clients).
//   - The number's owner sees all of its conversations.
//   - The full viewers (COMMS_FULL_VIEWERS: Ariel and Hadas) see every
//     conversation, with a client or without.
//   - A client's account manager sees that client's conversations.
//   - Nobody sees a message held by a block waiting for a manager; that is
//     filtered where messages are read, not here.

export type ViewerLike = { id: string; email: string };
export type ChannelLike = { ownerUserId: string; excludedViewerIds: string[] };
export type ConversationClient = { id: string; accountManagerId: string | null };

export function parseViewerEmails(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => Boolean(e));
}

export function canSeeConversation(input: {
  viewer: ViewerLike;
  channel: ChannelLike;
  clients: ConversationClient[];
  fullViewers: string[];
}): boolean {
  const { viewer, channel } = input;
  if (channel.excludedViewerIds.includes(viewer.id)) return false;
  if (channel.ownerUserId === viewer.id) return true;
  const email = normalizeEmail(viewer.email);
  if (email && input.fullViewers.includes(email)) return true;
  return input.clients.some((c) => c.accountManagerId === viewer.id);
}

export type BlockLike = { kind: "PHONE" | "CHAT"; value: string; status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" };

/// What the block list says about one conversation of a number.
export function blockStateFor(blocks: BlockLike[], target: { phone: string | null; chatId: string }): "none" | "pending" | "blocked" {
  const hits = blocks.filter(
    (b) => (b.kind === "PHONE" && target.phone !== null && b.value === target.phone) || (b.kind === "CHAT" && b.value === target.chatId),
  );
  if (hits.some((b) => b.status === "APPROVED")) return "blocked";
  if (hits.some((b) => b.status === "PENDING")) return "pending";
  return "none";
}
