"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { ASSIGNED_NUMBER_TO_RESOLVE, AUDIT_GROUP_RECIPIENT, assignSourceTitle } from "@/lib/comms/content-text";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { MAX_MESSAGE_LENGTH, canReplyTo, checkMessageText, maskPhone } from "@/lib/whatsapp-poc/access";
import { blockStateFor, isExcludedViewer } from "@/lib/comms/visibility";
import { chatPhone } from "@/lib/whatsapp-poc/inbox";
import { commsAccess } from "@/lib/comms/access";
import { UnipileError, getChat, readPocConfig, sendText, setReadStatus } from "@/lib/whatsapp-poc/unipile";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientContact, listClientPeople, updateClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { normalizePhone } from "@/lib/contact-normalize";
import { prisma } from "@/lib/prisma";
import { listAccessibleClients } from "@/lib/app-domain/clients";

export type SendState = { error?: string; sent?: boolean };

/// The words these actions answer with, in the reader's language (ADR 0006).
async function errors() {
  return getTranslations("comms.errors");
}

// Every check is repeated here, not trusted from the screen: the viewer
// list, the configuration, and above all the recipient. The chat is read
// back from Unipile through the sender's own account, so a hand-edited form
// cannot reach a chat on anyone else's number.
//
// 5.11.2026 (Ariel): replies are open, one to one and groups, from the
// person's own number only, with no extra confirmation. Not to a chat or a
// number on the block list (approved or pending), and not to a chat
// WhatsApp holds read-only. WHATSAPP_POC_SEND_MODE=test brings the test
// list back.
export async function sendPocMessageAction(_prev: SendState | undefined, formData: FormData): Promise<SendState> {
  const t = await errors();
  const user = await requireUser();
  const config = readPocConfig();
  const access = await commsAccess(user);
  if (!access.allowed) return { error: t("forbidden") };

  const chatId = String(formData.get("chatId") || "");
  if (!chatId || chatId.length > 200) return { error: t("badChat") };

  // 1.11.2026 (several numbers): the message goes out from the sender's own
  // number. A connected number only by its owner; the configured number
  // before it was connected, only by the full viewers.
  const channelId = String(formData.get("channelId") || "");
  let accountId: string | null = null;
  let blockChannelId: string | null = null;
  if (channelId) {
    const channel = await prisma.commsChannel.findUnique({ where: { id: channelId } });
    if (!channel || channel.ownerUserId !== user.id) return { error: t("onlyYourNumber") };
    accountId = channel.accountId;
    blockChannelId = channel.id;
  } else if (access.full && config.accountId && !(await prisma.commsChannel.findUnique({ where: { accountId: config.accountId } }))) {
    accountId = config.accountId;
  }
  if (!accountId || !config.apiKey) return { error: t("onlyYourNumber") };
  const unipile = { apiKey: config.apiKey, accountId };

  const checked = checkMessageText(formData.get("text"));
  if (!checked.ok) return { error: checked.code === "empty" ? t("emptyMessage") : t("tooLong", { max: MAX_MESSAGE_LENGTH }) };

  try {
    const chat = await getChat(unipile, chatId);
    if (!chat) return { error: t("chatNotFound") };
    if (chat.readOnly) return { error: t("readOnly") };
    if (!canReplyTo(chat, config.sendMode, config.sendTo)) {
      return { error: config.sendMode === "test" ? t("testMode") : t("sendKinds") };
    }
    if (blockChannelId) {
      const blocks = await prisma.commsBlock.findMany({ where: { channelId: blockChannelId }, select: { kind: true, value: true, status: true } });
      if (blockStateFor(blocks, { phone: chatPhone(chat), chatId: chat.id }) !== "none") {
        return { error: t("blocked") };
      }
    }
    await sendText(unipile, chat.id, checked.text);
    await recordAudit({
      actorId: user.id,
      action: "whatsapp_poc.message_sent",
      entityType: "WhatsAppChat",
      entityId: chat.id,
      // The length, not the text: the audit log is not a second copy of
      // the conversation.
      after: { to: chat.type === "group" ? AUDIT_GROUP_RECIPIENT : maskPhone(chat.phone), length: checked.text.length },
    });
  } catch (err) {
    if (err instanceof UnipileError) return { error: (await domainErrorText(err)) ?? err.message };
    throw err;
  }

  revalidatePath("/app/whatsapp-poc");
  return { sent: true };
}

export type ContactState = { error?: string; ok?: boolean };

async function contactError(err: unknown): Promise<string> {
  const t = await errors();
  if (err instanceof ForbiddenError) return t("noClientAccess");
  const text = await domainErrorText(err);
  if (text) return text;
  if (err instanceof Error) return err.message;
  return t("generic");
}

export type ClientPersonOption = { contactId: string; name: string };

/// The people in one client's file, for "שיוך ללקוח" (5.11.2026, Ariel: Oren
/// is NUX's CEO and in its file, but the number he writes from was not, and
/// the form could only add a new person, so his chat stayed "לא משויך" or
/// he would have been in the file twice). listClientPeople checks access to
/// the client and each person's audience, as the client file does.
export async function listClientPeopleForAssignAction(clientId: string): Promise<ClientPersonOption[]> {
  const user = await requireUser();
  if (!(await commsAccess(user)).allowed) return [];
  if (typeof clientId !== "string" || !clientId || clientId.length > 64) return [];
  try {
    const { contacts } = await listClientPeople(user, clientId);
    const t = await getTranslations("comms");
    return contacts.map((c) => ({ contactId: c.id, name: [c.person.name, c.role].filter(Boolean).join(", ") || t("noName") }));
  } catch {
    return [];
  }
}

/// A number added to someone already in a client's file. Shared by "שיוך
/// ללקוח" (picking an existing person) and "שיוך מספר נוסף".
async function addNumberToContact(
  user: Awaited<ReturnType<typeof requireUser>>,
  contactId: string,
  phone: string,
  clientId: string | null = null,
): Promise<ContactState> {
  const t = await errors();
  const contact = await prisma.clientContact.findUnique({
    where: { id: contactId },
    select: { clientId: true, deletedAt: true, person: { select: { phones: true } } },
  });
  if (!contact || contact.deletedAt || (clientId && contact.clientId !== clientId)) return { error: t("contactNotFound") };
  if (contact.person.phones.includes(phone)) return { error: t("numberAlreadyHis") };
  const owner = await prisma.person.findFirst({ where: { deletedAt: null, phones: { has: phone } }, select: { id: true } });
  if (owner) return { error: t("numberOtherContact") };
  try {
    await updateClientContact(user, contactId, { phones: [...contact.person.phones, phone] });
  } catch (err) {
    return { error: await contactError(err) };
  }
  revalidatePath("/app/whatsapp-poc");
  revalidatePath(`/app/clients/${contact.clientId}`);
  return { ok: true };
}

/// 1.11.2026 (communications screen): "שיוך ללקוח". A number nobody has
/// written down becomes a contact in one client's file, through the same
/// path as the client file's own form (addClientContact: access check,
/// one person per number, the audit row). Saved as uncertain, with what
/// would confirm it, because it came from a phone call and not from the
/// client.
export async function assignNumberToClientAction(_prev: ContactState | undefined, formData: FormData): Promise<ContactState> {
  const t = await errors();
  const user = await requireUser();
  if (!(await commsAccess(user)).allowed) return { error: t("forbidden") };

  const phone = normalizePhone(String(formData.get("phone") || "").slice(0, 40));
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return { error: t("badNumber") };
  const clientId = String(formData.get("clientId") || "");
  if (!clientId) return { error: t("pickClient") };
  // 5.11.2026: someone already in the file gets the number added, not a
  // second entry. The contact must be in the chosen client's file.
  const contactId = String(formData.get("contactId") || "");
  if (contactId) {
    if (contactId.length > 64) return { error: t("contactNotFound") };
    return addNumberToContact(user, contactId, phone, clientId);
  }
  const name = String(formData.get("name") || "").trim().slice(0, 120);
  const role = String(formData.get("role") || "").trim().slice(0, 120);
  if (!name && !role) return { error: t("nameOrRole") };

  try {
    // 1.11.2026 (Ariel): every item in a client's file names its source,
    // and here the source is the person at Ankora who made the link. One
    // entry per person, per client, per day in the client's source register.
    const title = assignSourceTitle(user.name ?? user.email);
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
      toResolve: ASSIGNED_NUMBER_TO_RESOLVE,
      sources: [{ code: source.code }],
    });
  } catch (err) {
    return { error: await contactError(err) };
  }
  revalidatePath("/app/whatsapp-poc");
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}

/// "שיוך מספר נוסף": another number for a person already in a client's
/// file. Goes through updateClientContact, which refuses what it would
/// refuse from the client file.
export async function addNumberToContactAction(_prev: ContactState | undefined, formData: FormData): Promise<ContactState> {
  const t = await errors();
  const user = await requireUser();
  if (!(await commsAccess(user)).allowed) return { error: t("forbidden") };

  const contactId = String(formData.get("contactId") || "");
  if (!contactId || contactId.length > 64) return { error: t("contactNotFound") };
  const phone = normalizePhone(String(formData.get("phone") || "").slice(0, 40));
  if (!phone || !/^\+\d{8,15}$/.test(phone)) return { error: t("badNumber") };

  return addNumberToContact(user, contactId, phone);
}

/// 1.11.2026: a WhatsApp group belongs to a client only when someone says
/// so (spec "שמירת שיחות"). The number's owner, or a manager, assigns it;
/// an empty choice removes the assignment. The client must be one the
/// person may reach.
export async function assignGroupToClientAction(_prev: ContactState | undefined, formData: FormData): Promise<ContactState> {
  const t = await errors();
  const user = await requireUser();
  const access = await commsAccess(user);
  if (!access.allowed) return { error: t("forbidden") };
  const channelId = String(formData.get("channelId") || "");
  const chatId = String(formData.get("chatId") || "").slice(0, 200);
  const clientId = String(formData.get("clientId") || "") || null;

  const channel = await prisma.commsChannel.findUnique({ where: { id: channelId } });
  if (!channel || (channel.ownerUserId !== user.id && !access.manager)) return { error: t("groupOwnerOnly") };
  const conversation = await prisma.commsConversation.findUnique({
    where: { channelId_externalChatId: { channelId, externalChatId: chatId } },
  });
  if (!conversation || !conversation.isGroup) return { error: t("groupNotFound") };
  if (clientId) {
    const reachable = await listAccessibleClients(user);
    if (!reachable.some((c) => c.id === clientId)) return { error: t("noClientAccess") };
  }
  await prisma.commsConversation.update({ where: { id: conversation.id }, data: { groupClientId: clientId } });
  await recordAudit({
    actorId: user.id,
    action: "comms_group.assigned",
    entityType: "CommsConversation",
    entityId: conversation.id,
    clientId,
    before: { groupClientId: conversation.groupClientId },
    after: { groupClientId: clientId },
  });
  revalidatePath("/app/whatsapp-poc");
  return { ok: true };
}

export type ReadState = { error?: string; ok?: boolean };

/// "סמן כנקראה" / "סמן כלא נקראה" (5.11.2026, Ariel): on a person's click
/// only; opening a chat never marks it. A row may stand for chats on two
/// numbers; each is marked on its own number, and only where this person
/// may read that number live (its owner, or the full viewers). The number is
/// checked here, never trusted from the screen.
export async function markChatsReadAction(input: { chats: Array<{ chatId: string; numberKey: string }>; read: boolean }): Promise<ReadState> {
  const t = await errors();
  const user = await requireUser();
  const config = readPocConfig();
  const access = await commsAccess(user);
  if (!access.allowed || !config.apiKey) return { error: t("forbidden") };
  const chats = Array.isArray(input?.chats) ? input.chats.slice(0, 5) : [];
  if (chats.length === 0) return { error: t("nothingToMark") };
  const read = input.read === true;

  let done = 0;
  try {
    for (const { chatId, numberKey } of chats) {
      if (typeof chatId !== "string" || !chatId || chatId.length > 200 || typeof numberKey !== "string") continue;
      let accountId: string | null = null;
      if (numberKey === "-") {
        const connected = config.accountId ? await prisma.commsChannel.findUnique({ where: { accountId: config.accountId }, select: { id: true } }) : null;
        if (access.full && config.accountId && !connected) accountId = config.accountId;
      } else {
        const channel = await prisma.commsChannel.findUnique({ where: { id: numberKey } });
        if (channel && !isExcludedViewer(channel, user.id) && (channel.ownerUserId === user.id || access.full)) {
          accountId = channel.accountId;
        }
      }
      if (!accountId) continue;
      await setReadStatus({ apiKey: config.apiKey, accountId }, chatId, read);
      done++;
    }
  } catch (err) {
    if (err instanceof UnipileError) return { error: (await domainErrorText(err)) ?? err.message };
    throw err;
  }
  if (done === 0) return { error: t("markOnlyYours") };
  revalidatePath("/app/whatsapp-poc");
  return { ok: true };
}
