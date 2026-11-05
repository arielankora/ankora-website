import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Who may own a connected WhatsApp number, or be on its "מי לא יראה" list
// (5.11.2026). Anna's number was connected to the wrong "Anna Kozlov": an
// archived user who had never signed in, picked from a list that held every
// staff user whatever their status. The owner sees every conversation on the
// line, so an owner who cannot sign in means nobody sees the unassigned ones.
//
// The rule: staff (not a client), not deleted, and status ACTIVE. Only ACTIVE
// can sign in (lib/app-auth/authenticate.ts and getCurrentUser in
// lib/app-auth/session.ts both refuse any other status), so ARCHIVED,
// SUSPENDED and INVITED are all left out. An invited employee becomes ACTIVE
// when they set their password, and can be chosen from then on.
//
// The same rule filters the lists on the setup screen and is checked again
// in the server actions, so a hand-made form cannot get around it.

export const CHANNEL_PERSON_WHERE = {
  deletedAt: null,
  status: "ACTIVE",
  role: { not: "CLIENT_USER" },
} satisfies Prisma.UserWhereInput;

export type ChannelPerson = { id: string; name: string; email: string };

export async function listChannelPeople(): Promise<ChannelPerson[]> {
  return prisma.user.findMany({
    where: CHANNEL_PERSON_WHERE,
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}

/// The ids among `ids` that do not meet the rule (unknown, deleted, a client,
/// or not ACTIVE). Empty when every one of them may be chosen.
export async function ineligibleChannelPeople(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const ok = await prisma.user.findMany({ where: { ...CHANNEL_PERSON_WHERE, id: { in: unique } }, select: { id: true } });
  const okIds = new Set(ok.map((u) => u.id));
  return unique.filter((id) => !okIds.has(id));
}

/// "Anna Kozlov (annam@ankora.co.il)": a name alone is not enough when two
/// people share it.
export function personLabel(p: { name: string | null; email: string }): string {
  return p.name ? `${p.name} (${p.email})` : p.email;
}
