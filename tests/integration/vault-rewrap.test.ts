import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createCredential } from "@/lib/app-domain/credentials";
import { rewrapVaultKeys } from "@/lib/app-domain/vault-rewrap";
import { credentialAad, openSecret } from "@/lib/vault/crypto";
import { unwrapDataKey } from "@/lib/vault/keys";

// Rotating the vault key (runbook "החלפת מפתח הכספת", lib/vault/keys.ts).
// What these pin: a rotation moves every row onto the new key without
// touching its secret, the old key can then be removed with nothing lost,
// and a row that is broken or belongs to another key is left exactly as
// it was.

const SECRET = { username: "dana@example.com", password: "S3cret pass ", notes: "שאלת אבטחה" };
const OLD = randomBytes(32).toString("base64");
const NEW = randomBytes(32).toString("base64");

beforeEach(() => {
  delete process.env.GCP_VAULT_KMS_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.VAULT_KEK_NEXT;
  process.env.VAULT_KEK = OLD;
});

async function credential(name = "ביטוח לאומי") {
  const client = await createTestClient({ name: `לקוח ${name}` });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  const { id } = await createCredential(user, { clientId: client.id, systemName: name, url: "example.com", ...SECRET });
  return prisma.clientCredential.findUniqueOrThrow({ where: { id } });
}

async function open(id: string) {
  const row = await prisma.clientCredential.findUniqueOrThrow({ where: { id } });
  const aad = credentialAad(row.id, row.clientId);
  const dek = await unwrapDataKey(Buffer.from(row.wrappedDek!), row.kekRef!, aad);
  return openSecret(
    { ciphertext: Buffer.from(row.secretCiphertext!), iv: Buffer.from(row.secretIv!), tag: Buffer.from(row.secretTag!) },
    dek,
    aad,
  );
}

describe("vault key rotation", () => {
  it("does nothing when no rotation is under way", async () => {
    await credential();
    const result = await rewrapVaultKeys();
    expect(result).toMatchObject({ rewrapped: 0, failed: 0, foreign: 0 });
    expect(result.current).toBe(result.total);
    expect(await prisma.auditEvent.count({ where: { action: "vault.rewrap" } })).toBe(0);
  });

  it("moves every row to the new key, leaves the secret as it was, and survives removing the old key", async () => {
    const before = await credential();
    process.env.VAULT_KEK_NEXT = NEW;

    const result = await rewrapVaultKeys();
    expect(result).toMatchObject({ rewrapped: 1, failed: 0, foreign: 0, skipped: 0 });

    const after = await prisma.clientCredential.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.kekRef).not.toBe(before.kekRef);
    expect(Buffer.from(after.secretCiphertext!).equals(Buffer.from(before.secretCiphertext!))).toBe(true);
    expect(Buffer.from(after.secretIv!).equals(Buffer.from(before.secretIv!))).toBe(true);

    // The last step of the runbook: the new value becomes VAULT_KEK and
    // the old key is gone.
    process.env.VAULT_KEK = NEW;
    delete process.env.VAULT_KEK_NEXT;
    expect(await open(before.id)).toEqual(SECRET);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "vault.rewrap" } });
    expect(audit?.afterJson).toMatchObject({ rewrapped: 1, failed: 0 });
    expect(JSON.stringify(audit?.afterJson)).not.toContain("S3cret");
  });

  it("is idempotent: a second run finds nothing to move", async () => {
    await credential();
    process.env.VAULT_KEK_NEXT = NEW;
    await rewrapVaultKeys();
    const again = await rewrapVaultKeys();
    expect(again).toMatchObject({ rewrapped: 0, failed: 0 });
    expect(again.current).toBe(again.total);
  });

  it("writes new credentials on the new key as soon as it is set", async () => {
    process.env.VAULT_KEK_NEXT = NEW;
    const row = await credential();
    process.env.VAULT_KEK = NEW;
    delete process.env.VAULT_KEK_NEXT;
    expect(await open(row.id)).toEqual(SECRET);
  });

  it("leaves a damaged row and another key's row untouched, and says so", async () => {
    const damaged = await credential("פגום");
    const bytes = Buffer.from(damaged.secretCiphertext!);
    bytes[0] ^= 1;
    await prisma.clientCredential.update({ where: { id: damaged.id }, data: { secretCiphertext: bytes } });

    const other = await credential("סביבה אחרת");
    await prisma.clientCredential.update({ where: { id: other.id }, data: { kekRef: "env:0000000000000000" } });

    process.env.VAULT_KEK_NEXT = NEW;
    const result = await rewrapVaultKeys();
    expect(result.failed).toBe(1);
    expect(result.foreign).toBe(1);

    expect((await prisma.clientCredential.findUniqueOrThrow({ where: { id: damaged.id } })).kekRef).toBe(damaged.kekRef);
    expect((await prisma.clientCredential.findUniqueOrThrow({ where: { id: other.id } })).kekRef).toBe("env:0000000000000000");
    const audit = await prisma.auditEvent.findFirst({ where: { action: "vault.rewrap" } });
    expect((audit?.afterJson as { failedIds: string[] }).failedIds).toEqual([damaged.id]);
  });
});
