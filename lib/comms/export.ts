import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { engagementDeletesOn } from "./engagement";
import type { CommsExport, ExportMessage } from "./export-render";

const ATTACHMENT_LABEL: Record<string, string> = { img: "תמונה", image: "תמונה", video: "וידאו", audio: "הקלטה", file: "קובץ", sticker: "מדבקה" };

/// What was kept of one client's people: the same numbers and groups the
/// engagement-end sweep removes 30 days after archiving, so the export
/// holds exactly what is about to go. A number the requester is excluded
/// from (Hadas and Ariel's number) is left out, as on the screen; held
/// messages (a block waiting for a manager) and deleted ones are not
/// exported.
export async function gatherCommsExport(
  requester: Pick<User, "id">,
  clientId: string,
  now: Date = new Date(),
): Promise<CommsExport | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, status: true, deletedAt: true } });
  if (!client) return null;

  const people = await prisma.clientContact.findMany({ where: { clientId }, select: { person: { select: { phones: true } } } });
  const phones = [...new Set(people.flatMap((p) => p.person.phones))];

  const conversations = await prisma.commsConversation.findMany({
    where: {
      OR: [...(phones.length ? [{ otherPhone: { in: phones } }] : []), { groupClientId: clientId }],
      // Not from a number this person is kept out of (lib/comms/visibility.ts:
      // named on its list, or "כולם" on a number that is not theirs).
      NOT: {
        channel: {
          OR: [{ excludedViewerIds: { has: requester.id } }, { excludeAllViewers: true, ownerUserId: { not: requester.id } }],
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: {
        where: { held: false, isDeleted: false },
        orderBy: { at: "asc" },
        include: { attachments: { select: { type: true, voiceNote: true, transcript: { select: { status: true, text: true } } } } },
      },
    },
  });

  const calls = phones.length
    ? await prisma.callRecording.findMany({
        where: { otherPhone: { in: phones } },
        orderBy: { callAt: "asc" },
        include: { transcript: { select: { status: true, text: true } } },
      })
    : [];

  return {
    clientName: client.name,
    generatedAt: now,
    deletesOn: client.status === "ARCHIVED" && client.deletedAt ? engagementDeletesOn(client.deletedAt) : null,
    conversations: conversations.map((c) => ({
      name: c.name,
      phone: c.otherPhone,
      isGroup: c.isGroup,
      messages: c.messages.map(
        (m): ExportMessage => ({
          at: m.at,
          fromUs: m.isSender,
          sender: m.senderName,
          text: [
            m.text,
            ...m.attachments
              .filter((a) => a.voiceNote && a.transcript?.status === "DONE" && a.transcript.text)
              .map((a) => `(תמלול הודעה קולית: ${a.transcript!.text})`),
          ]
            .filter(Boolean)
            .join(" "),
          attachments: m.attachments.map((a) => (a.voiceNote ? "הודעה קולית" : (ATTACHMENT_LABEL[a.type] ?? "קובץ"))),
        }),
      ),
    })),
    calls: calls.map((r) => ({
      at: r.callAt,
      direction: r.direction,
      phone: r.otherPhone,
      durationSec: r.durationSec,
      transcript: r.transcript?.status === "DONE" ? r.transcript.text : null,
    })),
  };
}
