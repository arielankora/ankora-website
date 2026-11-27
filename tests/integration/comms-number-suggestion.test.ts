import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// "נראה שזה..." (27.11.2026, Ariel: a chat should be assigned from what we
// already know). A number in no client's file that waits in a pending
// contact proposal is shown on the open chat, and one press approves that
// proposal, which puts the number in the file and assigns the chat.

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

import { approveNumberSuggestionAction } from "@/app/(product)/app/(authenticated)/whatsapp-poc/actions";
import { pendingContactsForPhone } from "@/lib/comms/number-suggestions";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function proposal(clientId: string, payload: Prisma.InputJsonObject) {
  const source = await prisma.clientSource.create({ data: { clientId, seq: 1, code: "S1", kind: "EMAIL", title: "מייל", externalRefs: [] } });
  const batch = await prisma.knowledgeBatch.create({ data: { clientId, sourceId: source.id } });
  return prisma.knowledgeProposal.create({ data: { batchId: batch.id, clientId, target: "CONTACT", payload, reason: "מהחתימה", confidence: "HIGH" } });
}

beforeEach(() => {
  session.user = null;
  process.env.UNIPILE_API_KEY = "k";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.ALOHA_LINE_OWNERS = "";
});

describe("נראה שזה...: a number waiting in a proposal", () => {
  it("finds the proposal however the number was written, and approving it assigns the chat", async () => {
    const { user } = await createTestUser({ role: "SUPER_ADMIN" });
    process.env.COMMS_FULL_VIEWERS = user.email;
    session.user = user;
    const client = await createTestClient({ name: "Grantor" });
    const p = await proposal(client.id, { name: "דנה לוי", phones: ["+972 (0)52-123-4567"], emails: ["dana@grantor.co.il"], sources: [{ code: "S1" }] });

    const found = await pendingContactsForPhone(user, "+972521234567");
    expect(found).toEqual([{ proposalId: p.id, clientId: client.id, clientName: "Grantor", name: "דנה לוי", action: "CREATE" }]);
    expect(await pendingContactsForPhone(user, "+972529999999")).toEqual([]);

    expect((await matchPhones(["+972521234567"])).get("+972521234567")?.clients ?? []).toEqual([]);
    expect(await approveNumberSuggestionAction(undefined, form({ proposalId: p.id }))).toEqual({ ok: true });
    expect((await matchPhones(["+972521234567"])).get("+972521234567")?.clients.map((c) => c.id)).toEqual([client.id]);
    expect(await pendingContactsForPhone(user, "+972521234567")).toEqual([]);
  });

  it("does not show a proposal of a client the person cannot reach", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient({ name: "לקוח אחר" });
    await proposal(client.id, { name: "יוסי", phones: ["052-7654321"] });
    expect(await pendingContactsForPhone(user, "+972527654321")).toEqual([]);
  });

  it("refuses an unknown proposal in words", async () => {
    const { user } = await createTestUser({ role: "SUPER_ADMIN" });
    process.env.COMMS_FULL_VIEWERS = user.email;
    session.user = user;
    const out = await approveNumberSuggestionAction(undefined, form({ proposalId: "nope" }));
    expect(out.ok).toBeUndefined();
    expect(out.error).toBeTruthy();
  });
});
