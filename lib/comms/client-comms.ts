import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { commsAccess, type CommsAccess } from "./access";
import { fullViewerEmails } from "./grants";
import { canSeeConversation } from "./visibility";
import { loadCallBlockIndex } from "./call-blocks";
import type { CallBlockIndex } from "./call-block-rules";
import { storedCallLine } from "./call-lines";
import { isExtractionAccount } from "./extraction-account";
import { quoteSender, type QuoteSender } from "./quote-sender";

// One client's stored communications, for the Ankora connector (14.11.2026):
// the WhatsApp conversations with the client's people and groups, and the
// recorded calls with their transcripts. The base for extracting knowledge
// into the client file, as Fireflies meetings are.
//
// The same rules as the communications screen, nothing looser:
//   - the person must have access to the communications screen at all;
//   - a conversation only if they may see it there (lib/comms/visibility.ts:
//     a number they are excluded from stays closed, even with their own
//     clients); a call only if they may hear it (their line, their client,
//     or every call);
//   - nothing held by a block waiting for a manager, and no call waiting
//     for one either;
//   - a number that also belongs to a client marked "בלי AI" is left out,
//     whatever client it is asked under. The client itself marked "בלי AI"
//     is refused before this is reached (lookupClient).

export type CommsDenied = { denied: "no_access" | "not_found" };

type Scope = {
  actor: User;
  access: CommsAccess;
  fullViewers: string[];
  client: { id: string; name: string; accountManagerId: string | null };
  phones: string[];
  blocks: CallBlockIndex;
};

async function scopeFor(actor: User, clientId: string): Promise<Scope | CommsDenied> {
  const access = await commsAccess(actor);
  if (!access.allowed) return { denied: "no_access" };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, accountManagerId: true } });
  if (!client) return { denied: "not_found" };
  const people = await prisma.clientContact.findMany({
    where: { clientId, deletedAt: null, person: { deletedAt: null } },
    select: { person: { select: { phones: true } } },
  });
  const all = [...new Set(people.flatMap((p) => p.person.phones))];
  // A number shared with a client marked "בלי AI" is that client's too.
  const marked = all.length
    ? new Set(
        (
          await prisma.person.findMany({
            where: {
              deletedAt: null,
              phones: { hasSome: all },
              contacts: { some: { deletedAt: null, client: { aiExcluded: true } } },
            },
            select: { phones: true },
          })
        ).flatMap((p) => p.phones),
      )
    : new Set<string>();
  const [fullViewers, blocks] = await Promise.all([fullViewerEmails(), loadCallBlockIndex()]);
  return { actor, access, fullViewers, client, phones: all.filter((p) => !marked.has(p)), blocks };
}

function seesConversation(
  s: Scope,
  channel: { ownerUserId: string; excludedViewerIds: string[]; excludeAllViewers: boolean; extractionAllowed: boolean },
) {
  // The extraction account reads every number that allows it (lib/comms/extraction-account.ts).
  if (channel.extractionAllowed && isExtractionAccount(s.actor.email)) return true;
  return canSeeConversation({
    viewer: { id: s.actor.id, email: s.actor.email },
    channel,
    clients: [{ id: s.client.id, accountManagerId: s.client.accountManagerId }],
    fullViewers: s.fullViewers,
  });
}

function hearsCall(s: Scope, rec: { direction: string; fromPhone: string; toPhone: string; otherPhone: string }) {
  const line = storedCallLine(rec);
  if (s.blocks.stateFor(line, rec.otherPhone) !== "none") return false;
  if (s.access.allCalls) return true;
  if (line && s.access.ownedLines?.includes(line)) return true;
  return s.client.accountManagerId === s.actor.id;
}

function conversationWhere(s: Scope) {
  return {
    OR: [...(s.phones.length ? [{ otherPhone: { in: s.phones } }] : []), { groupClientId: s.client.id }],
  };
}

export type ClientCommsList = {
  client: string;
  conversations: Array<{
    id: string;
    name: string;
    phone: string | null;
    isGroup: boolean;
    ourNumberOwner: string | null;
    messages: number;
    firstAt: Date | null;
    lastAt: Date | null;
  }>;
  calls: Array<{
    id: string;
    at: Date;
    direction: "IN" | "OUT" | "UNKNOWN";
    phone: string;
    durationSec: number | null;
    transcript: "DONE" | "PENDING" | "FAILED" | "SKIPPED" | "NONE";
  }>;
  hidden: { conversations: number; calls: number };
};

/// What there is for this client, since a moment (by message or call time).
export async function listClientComms(actor: User, clientId: string, since: Date | null): Promise<ClientCommsList | CommsDenied> {
  const s = await scopeFor(actor, clientId);
  if ("denied" in s) return s;
  const at = since ? { gte: since } : undefined;

  const conversations = await prisma.commsConversation.findMany({
    where: conversationWhere(s),
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: { channel: { select: { ownerUserId: true, excludedViewerIds: true, excludeAllViewers: true, extractionAllowed: true, owner: { select: { name: true } } } } },
  });
  const visible = conversations.filter((c) => seesConversation(s, c.channel));
  const stats = visible.length
    ? await prisma.commsMessage.groupBy({
        by: ["conversationId"],
        where: { conversationId: { in: visible.map((c) => c.id) }, held: false, ...(at ? { at } : {}) },
        _count: { _all: true },
        _min: { at: true },
        _max: { at: true },
      })
    : [];
  const statOf = new Map(stats.map((r) => [r.conversationId, r]));

  const calls = s.phones.length
    ? await prisma.callRecording.findMany({
        where: { otherPhone: { in: s.phones }, ...(at ? { callAt: at } : {}) },
        orderBy: { callAt: "asc" },
        take: 500,
        include: { transcript: { select: { status: true } } },
      })
    : [];
  const heard = calls.filter((r) => hearsCall(s, r));

  return {
    client: s.client.name,
    conversations: visible
      .map((c) => {
        const st = statOf.get(c.id);
        return {
          id: c.id,
          name: c.name,
          phone: c.otherPhone,
          isGroup: c.isGroup,
          ourNumberOwner: c.channel.owner.name,
          messages: st?._count._all ?? 0,
          firstAt: st?._min.at ?? null,
          lastAt: st?._max.at ?? null,
        };
      })
      .filter((c) => c.messages > 0),
    calls: heard.map((r) => ({
      id: r.id,
      at: r.callAt,
      direction: r.direction,
      phone: r.otherPhone,
      durationSec: r.durationSec,
      transcript: r.transcript?.status ?? "NONE",
    })),
    hidden: { conversations: conversations.length - visible.length, calls: calls.length - heard.length },
  };
}

export type ClientConversationPage = {
  client: string;
  conversation: { id: string; name: string; phone: string | null; isGroup: boolean; ourNumberOwner: string | null };
  messages: Array<{
    id: string;
    at: Date;
    fromAnkora: boolean;
    sender: string | null;
    text: string;
    deleted: boolean;
    edited: boolean;
    forwarded: boolean;
    quoted: string | null;
    /// Who wrote the quoted message (15.11.2026), never WhatsApp's hidden
    /// number: see lib/comms/quote-sender.ts.
    quotedFrom: QuoteSender | null;
    attachments: Array<{ kind: string; voiceTranscript: string | null; fileName: string | null }>;
  }>;
  /// Messages before the first one returned, for paging back.
  hasEarlier: boolean;
};

/// One conversation of the client, oldest first, in a time window.
export async function readClientConversation(
  actor: User,
  clientId: string,
  conversationId: string,
  opts: { since: Date | null; before: Date | null; limit: number },
): Promise<ClientConversationPage | CommsDenied> {
  const s = await scopeFor(actor, clientId);
  if ("denied" in s) return s;
  const c = await prisma.commsConversation.findFirst({
    where: { id: conversationId, ...conversationWhere(s) },
    include: { channel: { select: { ownerUserId: true, excludedViewerIds: true, excludeAllViewers: true, extractionAllowed: true, owner: { select: { name: true } } } } },
  });
  if (!c || !seesConversation(s, c.channel)) return { denied: "not_found" };

  const at = { ...(opts.since ? { gte: opts.since } : {}), ...(opts.before ? { lt: opts.before } : {}) };
  const where = { conversationId: c.id, held: false, ...(opts.since || opts.before ? { at } : {}) };
  // The latest `limit` in the window, returned oldest first.
  const rows = await prisma.commsMessage.findMany({
    where,
    orderBy: { at: "desc" },
    take: opts.limit + 1,
    include: {
      attachments: { select: { type: true, voiceNote: true, fileName: true, transcript: { select: { status: true, text: true } } } },
    },
  });
  const hasEarlier = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit).reverse();
  // The quoted messages, also when they are older than the page.
  const quotedIds = [...new Set(page.flatMap((m) => (m.quotedExternalId ? [m.quotedExternalId] : [])))];
  const originals = quotedIds.length
    ? await prisma.commsMessage.findMany({
        where: { conversationId: c.id, externalId: { in: quotedIds }, held: false },
        select: { externalId: true, isSender: true, senderName: true },
      })
    : [];
  const originalOf = new Map(originals.map((o) => [o.externalId, o]));
  return {
    client: s.client.name,
    conversation: { id: c.id, name: c.name, phone: c.otherPhone, isGroup: c.isGroup, ourNumberOwner: c.channel.owner.name },
    messages: page.map((m) => ({
      id: m.id,
      at: m.at,
      fromAnkora: m.isSender,
      sender: m.senderName,
      text: m.text,
      deleted: m.isDeleted,
      edited: m.isEdited,
      forwarded: m.forwarded,
      quoted: m.quotedText,
      quotedFrom:
        m.quotedExternalId || m.quotedText
          ? quoteSender({
              quotedName: m.quotedSenderName,
              original: (m.quotedExternalId && originalOf.get(m.quotedExternalId)) || null,
              isGroup: c.isGroup,
              chatName: c.name,
              chatPhone: c.otherPhone,
            })
          : null,
      attachments: m.attachments.map((a) => ({
        kind: a.voiceNote ? "voice" : a.type,
        voiceTranscript: a.voiceNote && a.transcript?.status === "DONE" ? a.transcript.text : null,
        fileName: a.fileName,
      })),
    })),
    hasEarlier,
  };
}

export type ClientCall = {
  client: string;
  call: {
    id: string;
    at: Date;
    direction: "IN" | "OUT" | "UNKNOWN";
    phone: string;
    durationSec: number | null;
    transcript: { status: "DONE" | "PENDING" | "FAILED" | "SKIPPED" | "NONE"; text: string | null };
    audioRemoved: boolean;
  };
};

/// One recorded call of the client, with its transcript.
export async function readClientCall(actor: User, clientId: string, recordingId: string): Promise<ClientCall | CommsDenied> {
  const s = await scopeFor(actor, clientId);
  if ("denied" in s) return s;
  const r = await prisma.callRecording.findUnique({ where: { id: recordingId }, include: { transcript: { select: { status: true, text: true } } } });
  if (!r || !s.phones.includes(r.otherPhone) || !hearsCall(s, r)) return { denied: "not_found" };
  const status = r.transcript?.status ?? "NONE";
  return {
    client: s.client.name,
    call: {
      id: r.id,
      at: r.callAt,
      direction: r.direction,
      phone: r.otherPhone,
      durationSec: r.durationSec,
      transcript: { status, text: status === "DONE" ? (r.transcript?.text ?? null) : null },
      audioRemoved: r.audioDeletedAt !== null,
    },
  };
}
