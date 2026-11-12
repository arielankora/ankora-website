import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_APP_LOCALE, type AppLocale } from "./config";
import { translatorFor, type Outgoing } from "./outgoing";

// ADR 0006, outgoing channels: the recipient's row decides the language of
// what is sent to them. These read it; lib/i18n/outgoing.ts words it.

type LocaleRow = { locale: AppLocale | null; timezone: string | null };

/// The words for one person, by id. Someone who cannot be found (deleted
/// between the decision and the send) gets Hebrew, as everyone did before.
export async function outgoingForUser(userId: string): Promise<Outgoing> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true, timezone: true } });
  return outgoingOf(row);
}

/// The same for several people in one read.
export async function outgoingForUsers(userIds: string[]): Promise<Map<string, Outgoing>> {
  const ids = [...new Set(userIds)];
  const rows = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, locale: true, timezone: true } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, outgoingOf(r)]));
  return new Map(ids.map((id) => [id, byId.get(id) ?? translatorFor(DEFAULT_APP_LOCALE)]));
}

export function outgoingOf(row: LocaleRow | null | undefined): Outgoing {
  return translatorFor(row?.locale ?? DEFAULT_APP_LOCALE, row?.timezone ?? null);
}

/// A list of addresses split by the language of the person behind each.
///
/// For emails that go to typed-in address lists (an alert rule's Ankora
/// recipients, a reminder's extra addresses). An address that is not an
/// app user's is not a person we know a language for, and keeps Hebrew:
/// part A of this stage changes only what reaches app users. Each group is
/// one send, so a list where everyone reads Hebrew is still one email,
/// exactly as before.
export async function groupEmailsByLocale(emails: string[]): Promise<{ out: Outgoing; to: string[] }[]> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { deletedAt: null, email: { in: unique.map((e) => e.toLowerCase()), mode: "insensitive" } },
    select: { email: true, locale: true, timezone: true },
  });
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const groups = new Map<string, { out: Outgoing; to: string[] }>();
  for (const email of unique) {
    const out = outgoingOf(byEmail.get(email.toLowerCase()));
    // By language only: a time zone difference inside one alert list is
    // not worth a second email, and these texts carry dates as Israeli days.
    const key = out.locale;
    const g = groups.get(key) ?? { out: translatorFor(out.locale), to: [] };
    g.to.push(email);
    groups.set(key, g);
  }
  // Hebrew first, so a mixed list sends the email it always sent first.
  return [...groups.values()].sort((a, b) => (a.out.locale === "he" ? -1 : b.out.locale === "he" ? 1 : 0));
}
