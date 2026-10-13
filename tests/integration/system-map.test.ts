import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientSource, removeClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess, listSystemMap, removeSystemAccess, updateSystemAccess } from "@/lib/app-domain/system-map";
import { assertResolvable, sourcedFields } from "@/lib/app-domain/knowledge-items";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 3.6).
//
// What is worth holding here: the map never holds a secret, a vault entry
// it links to is the same client's and is named only to people who may
// open the vault, and the gaps come first.

async function setup(role: "ANKORA_EMPLOYEE" | "ANKORA_ADMIN" = "ANKORA_EMPLOYEE") {
  const client = await createTestClient();
  const { user } = await createTestUser({ role });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישת חפיפה" });
  return { client, user };
}

const S1 = [{ code: "S1" }];

async function vaultEntry(clientId: string, userId: string, systemName: string) {
  return prisma.clientCredential.create({
    data: { id: randomUUID(), clientId, systemName, createdById: userId, updatedById: userId },
  });
}

describe("system map", () => {
  it("lists gaps first: pending, then no access, then the rest", async () => {
    const { client, user } = await setup();
    await addSystemAccess(user, { clientId: client.id, systemName: "Gusto", accessStatus: "HAS_ACCESS", sources: S1 });
    await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", accessStatus: "NO_ACCESS", blocker: "MFA לטלפון של המנכ״ל", sources: S1 });
    await addSystemAccess(user, { clientId: client.id, systemName: "Justworks", accessStatus: "PENDING", sources: S1 });
    await addSystemAccess(user, { clientId: client.id, systemName: "Payoneer", accessStatus: "NOT_NEEDED", sources: S1 });
    expect((await listSystemMap(user, client.id)).map((s) => s.systemName)).toEqual(["Justworks", "Mercury", "Gusto", "Payoneer"]);
  });

  it("never stores a secret: four card digits only, no passwords", async () => {
    const { client, user } = await setup();
    await expect(
      addSystemAccess(user, { clientId: client.id, systemName: "AWS", cardLast4: "4580123412341234", sources: S1 })
    ).rejects.toThrow("ארבע הספרות");
    await expect(
      addSystemAccess(user, { clientId: client.id, systemName: "AWS", accountUsed: "admin password: hunter2", sources: S1 })
    ).rejects.toThrow("בכספת");
    const ok = await addSystemAccess(user, { clientId: client.id, systemName: "AWS", cardLast4: "1234", url: "console.aws.amazon.com", sources: S1 });
    expect(ok.cardLast4).toBe("1234");
    expect(ok.url).toBe("https://console.aws.amazon.com/");
    expect(await prisma.systemAccess.count()).toBe(1);
  });

  it("the same system with the same account is refused; another account is a second row", async () => {
    const { client, user } = await setup();
    await addSystemAccess(user, { clientId: client.id, systemName: "Slack", accountUsed: "office@nux.ai", sources: S1 });
    await expect(
      addSystemAccess(user, { clientId: client.id, systemName: "slack", accountUsed: "Office@nux.ai", sources: S1 })
    ).rejects.toThrow("כבר במפת");
    await addSystemAccess(user, { clientId: client.id, systemName: "Slack", accountUsed: "ariel@nux.ai", sources: S1 });
    expect(await prisma.systemAccess.count()).toBe(2);
  });

  it("links a vault entry of the same client only, and names it only to people who may open the vault", async () => {
    const { client, user } = await setup("ANKORA_ADMIN");
    const other = await createTestClient({ name: "Other" });
    const mine = await vaultEntry(client.id, user.id, "Mercury");
    const theirs = await vaultEntry(other.id, user.id, "Mercury");

    await expect(
      addSystemAccess(user, { clientId: client.id, systemName: "Mercury", credentialId: theirs.id, sources: S1 })
    ).rejects.toThrow("בכספת");
    const row = await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", credentialId: mine.id, sources: S1 });
    expect((await listSystemMap(user, client.id))[0].credential).toEqual({ id: mine.id, systemName: "Mercury" });

    // An edit that does not mention the vault leaves the link alone.
    const edited = await updateSystemAccess(user, row.id, { purpose: "בנק של Inc" });
    expect(edited.credentialId).toBe(mine.id);
  });

  it("cites the register like every other item, and keeps the source from being removed", async () => {
    const { client, user } = await setup();
    await expect(addSystemAccess(user, { clientId: client.id, systemName: "Gusto" })).rejects.toThrow("צריך מקור");
    const row = await addSystemAccess(user, { clientId: client.id, systemName: "Gusto", sources: S1 });
    const s1 = await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, code: "S1" } });
    await expect(removeClientSource(user, s1.id)).rejects.toThrow("1 פריטים");
    await removeSystemAccess(user, row.id);
    await removeClientSource(user, s1.id);
  });

  it("is closed to anyone not assigned to the client", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(listSystemMap(stranger, client.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addSystemAccess(stranger, { clientId: client.id, systemName: "Gusto", sources: S1 })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("knowledge fields, shared by every item", () => {
  it("asks what would close a non-confirmed item, and merges sources with what is stored", async () => {
    expect(() => assertResolvable("UNCERTAIN", " ")).toThrow("מה יסגור");
    expect(() => assertResolvable("MISSING", "לבקש מהמנכ״ל")).not.toThrow();
    expect(() => assertResolvable("CONFIRMED", null)).not.toThrow();

    const { client } = await setup();
    // An edit that does not touch the sources keeps the stored ones.
    const kept = await sourcedFields(client.id, { toResolve: undefined }, [], {
      knowledgeStatus: "CONFIRMED",
      sources: [{ code: "S1", at: "02:10" }],
      toResolve: null,
    });
    expect(kept).toEqual({ sources: [{ code: "S1", at: "02:10" }], knowledgeStatus: "CONFIRMED", toResolve: null });
  });
});
