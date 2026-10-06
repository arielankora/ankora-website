import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { credentialAad, generateDataKey, openSecret, sealSecret } from "@/lib/vault/crypto";

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn(async () => "oidc-token") }));

// The vault's cryptography (claude/credentials-vault-spec-2026-10-06.md).
// What these pin is not that AES works, but the three properties the
// design leans on: a ciphertext opens only on the row it was written for,
// any change to the stored bytes is a refusal, and production refuses the
// test key that sits in the public CI workflow.

const SECRET = { username: "dana@example.com", password: "  pass with spaces  ", notes: null };

describe("seal / open", () => {
  it("round-trips, including a password with leading and trailing spaces", () => {
    const dek = generateDataKey();
    const aad = credentialAad("cred-1", "client-a");
    const sealed = sealSecret(SECRET, dek, aad);
    expect(openSecret(sealed, dek, aad)).toEqual(SECRET);
  });

  it("does not contain the plain text anywhere in what is stored", () => {
    const sealed = sealSecret(SECRET, generateDataKey(), credentialAad("cred-1", "client-a"));
    const stored = Buffer.concat([sealed.ciphertext, sealed.iv, sealed.tag]).toString("latin1");
    expect(stored).not.toContain("dana@example.com");
    expect(stored).not.toContain("pass with spaces");
  });

  it("refuses a ciphertext moved onto another client's row", () => {
    const dek = generateDataKey();
    const sealed = sealSecret(SECRET, dek, credentialAad("cred-1", "client-a"));
    expect(() => openSecret(sealed, dek, credentialAad("cred-1", "client-b"))).toThrow();
    expect(() => openSecret(sealed, dek, credentialAad("cred-2", "client-a"))).toThrow();
  });

  it("refuses a single flipped bit", () => {
    const dek = generateDataKey();
    const aad = credentialAad("cred-1", "client-a");
    const sealed = sealSecret(SECRET, dek, aad);
    sealed.ciphertext[0] ^= 1;
    expect(() => openSecret(sealed, dek, aad)).toThrow();
  });

  it("uses a fresh IV every time", () => {
    const dek = generateDataKey();
    const aad = credentialAad("cred-1", "client-a");
    expect(sealSecret(SECRET, dek, aad).iv.equals(sealSecret(SECRET, dek, aad).iv)).toBe(false);
  });
});

describe("key provider selection", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    vi.unstubAllGlobals();
  });

  async function keys() {
    vi.resetModules();
    return import("@/lib/vault/keys");
  }

  // Decision of 6.10.2026: production runs on a sensitive VAULT_KEK in
  // Vercel rather than on Cloud KMS.
  it("runs in production on its own environment key", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.VAULT_KEK = randomBytes(32).toString("base64");
    delete process.env.GCP_VAULT_KMS_KEY;
    const k = await keys();
    expect(k.isVaultConfigured()).toBe(true);
    const w = await k.wrapDataKey(generateDataKey(), Buffer.from("aad"));
    expect(w.kekRef).toMatch(/^env:[0-9a-f]{16}$/);
  });

  it("refuses the public CI key in production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.VAULT_KEK = "Y2ktb25seS12YXVsdC1rZXktbm90LWEtc2VjcmV0ISE=";
    delete process.env.GCP_VAULT_KMS_KEY;
    const k = await keys();
    expect(k.isVaultConfigured()).toBe(false);
  });

  it("is not configured without any key", async () => {
    delete process.env.VAULT_KEK;
    delete process.env.GCP_VAULT_KMS_KEY;
    const k = await keys();
    expect(k.isVaultConfigured()).toBe(false);
    await expect(k.wrapDataKey(generateDataKey(), Buffer.from("aad"))).rejects.toBeInstanceOf(k.VaultUnavailableError);
  });

  it("wraps and unwraps with the environment key", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.GCP_VAULT_KMS_KEY;
    process.env.VAULT_KEK = randomBytes(32).toString("base64");
    const k = await keys();
    const dek = generateDataKey();
    const aad = Buffer.from("aad");
    const w = await k.wrapDataKey(dek, aad);
    expect(w.kekRef).toMatch(/^env:[0-9a-f]{16}$/);
    expect((await k.unwrapDataKey(w.wrapped, w.kekRef, aad)).equals(dek)).toBe(true);
  });

  it("refuses, in words, a row wrapped by another environment's key", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.GCP_VAULT_KMS_KEY;
    process.env.VAULT_KEK = randomBytes(32).toString("base64");
    let k = await keys();
    const w = await k.wrapDataKey(generateDataKey(), Buffer.from("aad"));

    process.env.VAULT_KEK = randomBytes(32).toString("base64");
    k = await keys();
    await expect(k.unwrapDataKey(w.wrapped, w.kekRef, Buffer.from("aad"))).rejects.toBeInstanceOf(k.VaultKeyMismatchError);
    // A KMS-wrapped production row opened by a preview on a local key.
    await expect(
      k.unwrapDataKey(w.wrapped, "kms:projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1", Buffer.from("aad")),
    ).rejects.toBeInstanceOf(k.VaultKeyMismatchError);
  });

  it("sends KMS only the data key and the AAD, and records the key version used", async () => {
    const KEY = "projects/p/locations/europe-west1/keyRings/ankora/cryptoKeys/vault";
    process.env.VERCEL_ENV = "production";
    process.env.GCP_VAULT_KMS_KEY = KEY;
    process.env.GCP_PROJECT_NUMBER = "1";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "pool";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "prov";
    process.env.GCP_VAULT_SERVICE_ACCOUNT_EMAIL = "vault@p.iam.gserviceaccount.com";

    const calls: { url: string; body: any; auth?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, auth: init.headers?.Authorization });
        if (url.includes("sts.googleapis.com")) return Response.json({ access_token: "fed" });
        if (url.includes("generateAccessToken")) return Response.json({ accessToken: "sa", expireTime: new Date(Date.now() + 900_000).toISOString() });
        if (url.endsWith(":encrypt")) return Response.json({ name: `${KEY}/cryptoKeyVersions/3`, ciphertext: Buffer.from("wrapped").toString("base64") });
        if (url.endsWith(":decrypt")) return Response.json({ plaintext: Buffer.alloc(32, 7).toString("base64") });
        return new Response("no", { status: 500 });
      }),
    );

    const k = await keys();
    const aad = Buffer.from("ankora.credential.v1|c|cl");
    const w = await k.wrapDataKey(Buffer.alloc(32, 7), aad);
    expect(w.kekRef).toBe(`kms:${KEY}/cryptoKeyVersions/3`);
    const enc = calls.find((c) => c.url.endsWith(":encrypt"))!;
    expect(enc.url).toBe(`https://cloudkms.googleapis.com/v1/${KEY}:encrypt`);
    expect(enc.auth).toBe("Bearer sa");
    expect(enc.body.additionalAuthenticatedData).toBe(aad.toString("base64"));
    // The vault's own service account, scoped to KMS only.
    const imp = calls.find((c) => c.url.includes("generateAccessToken"))!;
    expect(imp.url).toContain(encodeURIComponent("vault@p.iam.gserviceaccount.com"));
    expect(imp.body.scope).toEqual(["https://www.googleapis.com/auth/cloudkms"]);

    const dek = await k.unwrapDataKey(w.wrapped, w.kekRef, aad);
    expect(dek.equals(Buffer.alloc(32, 7))).toBe(true);
  });
});
