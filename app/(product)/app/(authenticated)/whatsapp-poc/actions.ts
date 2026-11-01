"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSendTo, canViewWhatsappPoc, checkMessageText, maskPhone } from "@/lib/whatsapp-poc/access";
import { UnipileError, getChat, isConfigured, readPocConfig, sendText } from "@/lib/whatsapp-poc/unipile";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientContact, updateClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { normalizePhone } from "@/lib/contact-normalize";
import { prisma } from "@/lib/prisma";

export type SendState = { error?: string; sent?: boolean };

// Every check is repeated here, not trusted from the screen: the viewer
// list, the configuration, and above all the recipient. The chat is read
// back from Unipile and its own number is checked against the send list,
// so a hand-edited form cannot reach any other chat.
export async function sendPocMessageAction(_prev: SendState | undefined, formData: FormData): Promise<SendState> {
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return { error: "אין הרשאה." };
  if (!isConfigured(config)) return { error: "ה-POC לא מוגדר בסביבה הזו." };

  const chatId = String(formData.get("chatId") || "");
  if (!chatId || chatId.length > 200) return { error: "שיחה לא תקינה." };

  const checked = checkMessageText(formData.get("text"));
  if (!checked.ok) return { error: checked.error };

  try {
    const chat = await getChat(config, chatId);
    if (!chat || chat.type !== "1to1" || !canSendTo(chat.phone, config.sendTo)) {
      return { error: "שליחה מותרת רק למספרים שברשימת הבדיקה." };
    }
    await sendText(config, chat.id, checked.text);
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.message_sent",
      entityType: "WhatsAppChat",
      entityId: chat.id,
      // The length, not the text: the audit log is not a second copy of
      // the conversation.
      after: { to: maskPhone(chat.phone), length: checked.text.length },
    });
  } catch (err) {
    if (err instanceof UnipileError) return { error: err.message };
    throw err;
  }

  revalidatePath("/app/whatsapp-poc");
  return { sent: true };
}

export type ContactState = { error?: string; ok?: boolean };

function contactError(err: unknown): string {
  if (err instanceof ForbiddenError) return "אין לך גישה ללקוח הזה.";
  if (err instanceof Error) return err.message;
  return "אירעה שגיאה. נסו שוב.";
}

/// 1.11.2026 (communications screen): "שיוך ללקוח". A number nobody has
/// written down becomes a contact in one client's file, through the same
/// path as the client file's own form (addClientContact: access check,
/// one person per number, the audit row). Saved as uncertain, with what
/// would confirm it, because it came from a phone call and not from the
/// client.
export async function assignNumberToClientAction(_prev: ContactState | undefined, formData: FormData): Promise<ContactState> {
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return { error: "אין הרשאה." };

  const phone = normalizePhone(String(formData.get("phone") || "").slice(0, 40));
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return { error: "מספר לא תקין." };
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: "יש לבחור לקוח." };
  const name = String(formData.get("name") || "").trim().slice(0, 120);
  const role = String(formData.get("role") || "").trim().slice(0, 120);
  if (!name && !role) return { error: "צריך שם או תפקיד." };

  try {
    // 1.11.2026 (Ariel): every item in a client's file names its source,
    // and here the source is the person at Ankora who made the link. One
    // entry per person, per client, per day in the client's source register.
    const title = `שיוך מספר ממסך התקשורת, בידי ${user.name ?? user.email}`;
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const existing = await prisma.clientSource.findFirst({
      where: { clientId, title, occurredAt: today, deletedAt: null },
      select: { code: true },
    });
    const source =
      existing ??
      (await addClientSource(user, {
        clientId,
        kind: "PERSON",
        weight: "SECONDARY",
        title,
        occurredAt: today,
        participants: [user.name ?? user.email],
      }));
    await addClientContact(user, {
      clientId,
      name: name || null,
      role: role || null,
      phones: [phone],
      knowledgeStatus: "UNCERTAIN",
      toResolve: "המספר שויך ממסך התקשורת. לאשר מול הלקוח.",
      sources: [{ code: source.code }],
    });
  } catch (err) {
    return { error: contactError(err) };
  }
  revalidatePath("/app/whatsapp-poc");
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/// "שיוך מספר נוסף": another number for a person already in a client's
/// file. Goes through updateClientContact, which refuses what it would
/// refuse from the client file.
export async function addNumberToContactAction(_prev: ContactState | undefined, formData: FormData): Promise<ContactState> {
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return { error: "אין הרשאה." };

  const contactId = String(formData.get("contactId") || "");
  if (!contactId || contactId.length > 64) return { error: "איש הקשר לא נמצא." };
  const phone = normalizePhone(String(formData.get("phone") || "").slice(0, 40));
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return { error: "מספר לא תקין." };

  const contact = await prisma.clientContact.findUnique({
    where: { id: contactId },
    select: { clientId: true, deletedAt: true, person: { select: { phones: true } } },
  });
  if (!contact || contact.deletedAt) return { error: "איש הקשר לא נמצא." };
  if (contact.person.phones.includes(phone)) return { error: "המספר כבר רשום אצלו." };
  const owner = await prisma.person.findFirst({ where: { deletedAt: null, phones: { has: phone } }, select: { id: true } });
  if (owner) return { error: "המספר כבר שייך לאיש קשר אחר." };

  try {
    await updateClientContact(user, contactId, { phones: [...contact.person.phones, phone] });
  } catch (err) {
    return { error: contactError(err) };
  }
  revalidatePath("/app/whatsapp-poc");
  revalidatePath(`/app/clients/${contact.clientId}`);
  return { ok: true };
}
