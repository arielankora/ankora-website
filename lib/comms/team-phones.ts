import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/contact-normalize";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { readAccount } from "./self-connect";

// The team's own numbers (24.11.2026, Ariel): a conversation between two of
// them is seen only by the two people in it, not by the full viewers, the
// account managers or the extraction account (lib/comms/visibility.ts).
// Until now Ariel's "כולם" kept his number's copy of a chat private, but the
// same chat was kept on the other person's number too, and the full viewers
// read it there.
//
// The team's numbers are every connected WhatsApp number and the Aloha
// lines. A number's phone is read from Unipile once (the account's user_id)
// and kept on the channel.

function e164(digits: string | null): string | null {
  if (!digits) return null;
  const phone = normalizePhone(`+${digits.replace(/^\+/, "")}`);
  return phone && /^\+\d{8,15}$/.test(phone) ? phone : null;
}

export const teamPhones = cache(async (): Promise<Set<string>> => {
  const channels = await prisma.commsChannel.findMany({ select: { id: true, accountId: true, phone: true } });
  const phones = new Set<string>(readPocConfig().lineNumbers);
  for (const ch of channels) {
    let phone = ch.phone;
    if (!phone) {
      try {
        phone = e164((await readAccount(ch.accountId)).userId);
        if (phone) await prisma.commsChannel.update({ where: { id: ch.id }, data: { phone } });
      } catch (err) {
        console.error("team-phones: could not read a number's phone", { channelId: ch.id }, err);
      }
    }
    if (phone) phones.add(phone);
  }
  return phones;
});
