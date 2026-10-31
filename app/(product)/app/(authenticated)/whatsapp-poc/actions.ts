"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSendTo, canViewWhatsappPoc, checkMessageText, maskPhone } from "@/lib/whatsapp-poc/access";
import { UnipileError, getChat, isConfigured, readPocConfig, sendText } from "@/lib/whatsapp-poc/unipile";

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
