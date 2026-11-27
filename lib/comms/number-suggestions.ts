import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { normalizePhones } from "@/lib/contact-normalize";

// "נראה שזה..." (27.11.2026, Ariel: "אמור להתעדכן אוטומטית על פי הפרטים שיש
// לנו כבר"). A chat is matched to a client by a contact's number in the
// file (lib/whatsapp-poc/clients-by-phone.ts). A number that is not in a
// file yet may already wait in a proposal for one: a new contact, or a
// number added to a known one, from an email signature or a meeting. The
// open chat shows it, and one press approves that proposal, which puts the
// number in the file and so assigns the chat.

export type NumberSuggestion = {
  proposalId: string;
  clientId: string;
  clientName: string;
  /// The person's name as the proposal has it, when it has one.
  name: string | null;
  /// CREATE: a new contact. SUPERSEDE: a number added to a known contact.
  action: string;
};

/// Whether a proposal's payload holds this number, however it was written.
export function payloadHasPhone(payload: unknown, phone: string): boolean {
  const phones = (payload as { phones?: unknown } | null)?.phones;
  if (!Array.isArray(phones)) return false;
  return normalizePhones(phones.filter((p): p is string => typeof p === "string")).includes(phone);
}

/// The pending contact proposals, in clients this person may reach, that
/// hold this number. Newest first.
export async function pendingContactsForPhone(actor: User, phone: string): Promise<NumberSuggestion[]> {
  const clients = await listAccessibleClients(actor);
  if (!clients.length) return [];
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const rows = await prisma.knowledgeProposal.findMany({
    where: { state: "PENDING", target: "CONTACT", action: { in: ["CREATE", "SUPERSEDE"] }, clientId: { in: [...nameOf.keys()] } },
    select: { id: true, clientId: true, action: true, payload: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows
    .filter((r) => payloadHasPhone(r.payload, phone))
    .map((r) => {
      const name = (r.payload as { name?: unknown } | null)?.name;
      return {
        proposalId: r.id,
        clientId: r.clientId,
        clientName: nameOf.get(r.clientId) ?? "",
        name: typeof name === "string" && name.trim() ? name.trim() : null,
        action: r.action,
      };
    });
}
