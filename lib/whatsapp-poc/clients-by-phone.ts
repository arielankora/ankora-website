import "server-only";
import { prisma } from "@/lib/prisma";

export type PhoneMatch = { personName: string | null; clients: Array<{ id: string; name: string }> };

/// Who a number belongs to in the client files: the person (Person.phones,
/// stored in E.164) and every client whose file lists them. Read only.
/// A number nobody has written down yet is simply absent from the map.
export async function matchPhones(phones: string[]): Promise<Map<string, PhoneMatch>> {
  const wanted = [...new Set(phones)].filter((p) => /^\+\d{8,15}$/.test(p));
  const out = new Map<string, PhoneMatch>();
  if (wanted.length === 0) return out;
  const people = await prisma.person.findMany({
    where: { phones: { hasSome: wanted }, deletedAt: null },
    select: {
      name: true,
      phones: true,
      contacts: { where: { deletedAt: null }, select: { client: { select: { id: true, name: true } } } },
    },
  });
  for (const person of people) {
    for (const phone of person.phones) {
      if (!wanted.includes(phone)) continue;
      const existing = out.get(phone) ?? { personName: person.name, clients: [] };
      for (const c of person.contacts) {
        if (!existing.clients.some((x) => x.id === c.client.id)) existing.clients.push(c.client);
      }
      out.set(phone, existing);
    }
  }
  return out;
}
