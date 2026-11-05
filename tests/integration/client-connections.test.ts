import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addAppPasswordConnection, addGoogleConnection, disconnect, listConnections } from "@/lib/app-domain/connections";
import { openConnectionSecret } from "@/lib/app-domain/credentials";

// 4.11.2026 (task cmvtivumj000pjs08q9qj4t67, ADR 0001 section 24): a
// client's connections. The secret is in the vault and nowhere else, only a
// manager or the account manager connects, every use is audited, and a
// disconnect deletes the secret and keeps the history.

beforeAll(() => {
  process.env.VAULT_KEK = process.env.VAULT_KEK ?? randomBytes(32).toString("base64");
});

async function setup() {
  const client = await createTestClient({ name: "Grantor" });
  const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: colleague } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: manager.id } });
  for (const u of [manager, colleague]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  return { client, manager, colleague };
}

describe("client connections", () => {
  it("keep the secret in the vault only, and open it with an audit row first", async () => {
    const { client, manager } = await setup();
    const { id } = await addAppPasswordConnection(manager, { clientId: client.id, account: "Nadav@Client.com", appPassword: "abcd efgh ijkl mnop", consentText: "נדב, במייל ב-4.11.2026" });
    const row = await prisma.clientConnection.findUniqueOrThrow({ where: { id } });
    expect(row.account).toBe("nadav@client.com");
    expect(JSON.stringify(row)).not.toContain("abcdefghijklmnop");
    const vault = await prisma.clientCredential.findUniqueOrThrow({ where: { id: row.credentialId! } });
    expect(Buffer.from(vault.secretCiphertext!).toString("utf8")).not.toContain("abcdefghijklmnop");

    const secret = await openConnectionSecret({ credentialId: row.credentialId!, connectionId: id, actorId: manager.id, purpose: "בדיקה" });
    expect(secret).toBe("abcdefghijklmnop");
    const audit = await prisma.auditEvent.findFirst({ where: { action: "credential.use_by_connection", entityId: row.credentialId! } });
    expect(audit).not.toBeNull();

    const [listed] = await listConnections(manager, client.id);
    expect(listed).toMatchObject({ id, kind: "MAIL_APP_PASSWORD", account: "nadav@client.com", usedBy: 0 });
    expect(Object.keys(listed)).not.toContain("credentialId");
  });

  it("are added only by a manager or the account manager, and need who handed the access over", async () => {
    const { client, manager, colleague } = await setup();
    await expect(addAppPasswordConnection(colleague, { clientId: client.id, account: "a@b.co", appPassword: "12345678", consentText: "x" })).rejects.toThrow("מנהל התיק");
    await expect(addAppPasswordConnection(manager, { clientId: client.id, account: "a@b.co", appPassword: "12345678", consentText: " " })).rejects.toThrow("מסר את הגישה");
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(listConnections(stranger, client.id)).rejects.toThrow();
  });

  it("record the account manager's own mailbox for sending, and a disconnect deletes the secret and keeps the history", async () => {
    const { client, manager } = await setup();
    const { id } = await addGoogleConnection(manager, { clientId: client.id, purpose: "SEND", account: "manager@ankora.co.il", refreshToken: "1//fake-refresh", scopes: ["https://www.googleapis.com/auth/gmail.send"] });
    const row = await prisma.clientConnection.findUniqueOrThrow({ where: { id } });
    expect(row.kind).toBe("MANAGER_SEND");
    expect(row.ownerUserId).toBe(manager.id);

    // Revoking at Google is best effort; no network in tests.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    try {
      await disconnect(manager, id);
    } finally {
      globalThis.fetch = realFetch;
    }
    const after = await prisma.clientConnection.findUniqueOrThrow({ where: { id } });
    expect(after.revokedAt).not.toBeNull();
    expect(after.credentialId).toBeNull();
    const vault = await prisma.clientCredential.findUniqueOrThrow({ where: { id: row.credentialId! } });
    expect(vault.deletedAt).not.toBeNull();
    expect(vault.secretCiphertext).toBeNull();
    expect(await listConnections(manager, client.id)).toEqual([]);
  });
});
