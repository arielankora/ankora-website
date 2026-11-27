import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { outgoingOf } from "@/lib/i18n/recipients";
import { disconnectCc } from "@/lib/comms/disconnect-alert";

// A connected mailbox that Unipile disconnected (27.11.2026), told the way a
// disconnected WhatsApp number is (lib/comms/disconnect-alert.ts): its owner
// gets an email and a notification with the reconnect link, with Ariel and
// Hadas on copy, at most once a day for the same mailbox.

export const MAIL_DISCONNECTED_NOTIFICATION_TYPE = "mail_channel_disconnected";
const DAY_MS = 24 * 60 * 60 * 1000;

export async function alertMailChannelDisconnected(accountId: string, now = new Date()): Promise<"sent" | "recent" | "no-channel"> {
  const channel = await prisma.mailChannel.findUnique({
    where: { accountId },
    include: { owner: { select: { id: true, email: true, name: true, locale: true, timezone: true } } },
  });
  if (!channel) return "no-channel";
  const recent = await prisma.notification.findFirst({
    where: { type: MAIL_DISCONNECTED_NOTIFICATION_TYPE, entityId: channel.id, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    select: { id: true },
  });
  if (recent) return "recent";

  const { t } = outgoingOf(channel.owner);
  const owner = channel.owner.name || channel.owner.email || "";
  const link = `${appBaseUrl()}/app/whatsapp-poc/mail/connect`;
  const title = t("mailChannelDisconnected.title", { owner, address: channel.address });
  const body = t("mailChannelDisconnected.body", { owner, address: channel.address, link });
  await prisma.notification.create({
    data: { userId: channel.owner.id, type: MAIL_DISCONNECTED_NOTIFICATION_TYPE, title, body, entityType: "MailChannel", entityId: channel.id },
  });
  console.warn("mail-scan: mailbox disconnected, owner told", { channelId: channel.id });
  const to = channel.owner.email ? [channel.owner.email] : disconnectCc(null);
  const cc = channel.owner.email ? disconnectCc(channel.owner.email) : [];
  const sent = await sendEmail({ to, cc, subject: `Ankora - ${title}`, text: body });
  if (!sent.ok) console.error("mail-scan: the disconnect email was not sent", { channelId: channel.id, error: sent.error });
  return "sent";
}
