import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// "שיוך ללקוח" on the communications screen (5.11.2026). Oren, NUX's CEO, is
// in NUX's file, but the number he writes from on WhatsApp was not, so his
// chat showed "לא משויך ללקוח", and the form could only add a new person: he
// would have been in the file twice. Now the form lists the client's people
// and adds the number to the one picked.

const session = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  const current = async () => {
    if (!session.user) throw new UnauthorizedError();
    return session.user;
  };
  return { UnauthorizedError, requireUser: current, requireUserOrThrow: current, getCurrentUser: async () => session.user };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { assignNumberToClientAction, listClientPeopleForAssignAction } from "@/app/(product)/app/(authenticated)/whatsapp-poc/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const PHONE = "+14155356690";

async function setup() {
  const { user } = await createTestUser({ role: "SUPER_ADMIN" });
  process.env.COMMS_FULL_VIEWERS = user.email;
  session.user = user;
  const client = await createTestClient({ name: "NUX" });
  // Through the real path, so the contact carries a source as every contact
  // in a client's file does.
  const made = await assignNumberToClientAction(undefined, form({ phone: "+972501111111", clientId: client.id, name: "אורן רובין", role: "מנכ\"ל" }));
  expect(made).toEqual({ ok: true });
  const contact = await prisma.clientContact.findFirstOrThrow({ where: { clientId: client.id }, include: { person: true } });
  return { user, client, person: contact.person, contact };
}

beforeEach(() => {
  session.user = null;
  process.env.UNIPILE_API_KEY = "k";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.ALOHA_LINE_OWNERS = "";
});

describe("שיוך ללקוח: someone already in the file", () => {
  it("lists the client's people for the form", async () => {
    const { client, contact } = await setup();
    const people = await listClientPeopleForAssignAction(client.id);
    expect(people).toEqual([{ contactId: contact.id, name: "אורן רובין, מנכ\"ל" }]);
  });

  it("adds the number to the person picked, without a second entry", async () => {
    const { client, person, contact } = await setup();
    const result = await assignNumberToClientAction(undefined, form({ phone: PHONE, clientId: client.id, contactId: contact.id }));
    expect(result).toEqual({ ok: true });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).phones).toEqual(["+972501111111", PHONE]);
    expect(await prisma.clientContact.count({ where: { clientId: client.id, deletedAt: null } })).toBe(1);
  });

  it("refuses a person from another client's file", async () => {
    const { contact } = await setup();
    const other = await createTestClient({ name: "Other" });
    const result = await assignNumberToClientAction(undefined, form({ phone: PHONE, clientId: other.id, contactId: contact.id }));
    expect(result.error).toBe("איש הקשר לא נמצא.");
  });

  it("still adds a new person when none is picked", async () => {
    const { client } = await setup();
    const result = await assignNumberToClientAction(undefined, form({ phone: "+972541234567", clientId: client.id, name: "מישהו חדש" }));
    // A new person is a second entry; the number is not added to Oren.
    expect(result).toEqual({ ok: true });
    expect(await prisma.clientContact.count({ where: { clientId: client.id, deletedAt: null } })).toBe(2);
  });
});
