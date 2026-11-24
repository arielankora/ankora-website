import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { outgoingOf } from "@/lib/i18n/recipients";

// A WhatsApp number that Unipile disconnected (24.11.2026: Anna's number
// stopped for a day before anyone noticed). Its owner gets an email and a
// notification with the reconnect link, with Ariel and Hadas on copy, at
// most once a day for the same number. It comes from Unipile's
// account.status.disconnected webhook, and from the nightly run when a
// number fails because it is disconnected, in case the webhook was missed.

export const CHANNEL_DISCONNECTED_NOTIFICATION_TYPE = "channel_disconnected";
/// Ariel, 24.11.2026: "צריך לכתב את אריאל והדס גם על המייל".
export const DISCONNECT_CC = ["ariel@ankora.co.il", "hadas@ankora.co.il"];
const DAY_MS = 24 * 60 * 60 * 1000;

/// Who is on copy: everyone on the list except the owner, who is already on "to".
export function disconnectCc(ownerEmail: string | null): string[] {
  const owner = ownerEmail?.trim().toLowerCase() ?? "";
  return DISCONNECT_CC.filter((e) => e !== owner);
}

export async function alertChannelDisconnected(
  accountId: string,
  now = new Date(),
): Promise<"sent" | "recent" | "no-channel"> {
  const channel = await prisma.commsChannel.findUnique({
    where: { accountId },
    include: { owner: { select: { id: true, email: true, name: true, locale: true, timezone: true } } },
  });
  if (!channel) return "no-channel";
  const recent = await prisma.notification.findFirst({
    where: { type: CHANNEL_DISCONNECTED_NOTIFICATION_TYPE, entityId: channel.id, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    select: { id: true },
  });
  if (recent) return "recent";

  const { t } = outgoingOf(channel.owner);
  const owner = channel.owner.name || channel.owner.email || "";
  const link = `${appBaseUrl()}/app/whatsapp-poc/connect`;
  const title = t("channelDisconnected.title", { owner });
  const body = t("channelDisconnected.body", { owner, link });
  await prisma.notification.create({
    data: { userId: channel.owner.id, type: CHANNEL_DISCONNECTED_NOTIFICATION_TYPE, title, body, entityType: "CommsChannel", entityId: channel.id },
  });
  console.warn("comms: WhatsApp number disconnected, owner told", { channelId: channel.id });
  const to = channel.owner.email ? [channel.owner.email] : disconnectCc(null);
  const cc = channel.owner.email ? disconnectCc(channel.owner.email) : [];
  const sent = await sendEmail({ to, cc, subject: `Ankora - ${title}`, text: body });
  if (!sent.ok) console.error("comms: the disconnect email was not sent", { channelId: channel.id, error: sent.error });
  return "sent";
}
