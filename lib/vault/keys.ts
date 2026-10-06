import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getVaultAccessToken } from "./gcp-token";
import { isProductionDeployment } from "@/lib/env";

// Credentials vault, the key-encryption half.
//
// Wraps and unwraps each row's data key. Two providers, never mixed:
//
//   * Environment key (VAULT_KEK, base64 of 32 random bytes). What runs
//     today, in every environment, each with its OWN value. Decision of
//     6.10.2026: Ariel chose this over Cloud KMS rather than open a Google
//     billing account for the project. In production the variable must be
//     of type "sensitive" in Vercel, which nobody can read back from the
//     dashboard or the API. The price, stated so it is not forgotten: a
//     leak of the database AND of the production environment together
//     exposes every password. KMS would have closed that.
//
//   * Cloud KMS (GCP_VAULT_KMS_KEY set). Built and tested, not configured.
//     The key-encryption key would live in KMS and never leave it. Setting
//     the variable switches new writes to KMS; rows wrapped by the
//     environment key keep their own kekRef and need a one-off re-wrap
//     before VAULT_KEK can be removed.
//
// Every wrapped key records which key wrapped it (`kekRef`). A row written
// under one environment's key is refused by another's with a sentence
// that says so - which is exactly what a preview deployment sees when it
// opens a Neon branch copied from production.

export class VaultUnavailableError extends Error {
  constructor(message = "הכספת עוד לא הוגדרה בסביבה הזו.") {
    super(message);
    this.name = "VaultUnavailableError";
  }
}

export class VaultKeyMismatchError extends Error {
  constructor() {
    super("הרשומה הזו הוצפנה במפתח של סביבה אחרת, ולכן אי אפשר לפתוח אותה כאן.");
    this.name = "VaultKeyMismatchError";
  }
}

export interface WrappedKey {
  wrapped: Buffer;
  kekRef: string;
}

interface KeyProvider {
  wrap(dek: Buffer, aad: Buffer): Promise<WrappedKey>;
  unwrap(wrapped: Buffer, kekRef: string, aad: Buffer): Promise<Buffer>;
}

// ── Cloud KMS ─────────────────────────────────────────────────────────

function kmsProvider(keyName: string): KeyProvider {
  if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(keyName)) {
    throw new VaultUnavailableError("GCP_VAULT_KMS_KEY אינו שם מפתח תקין של Cloud KMS.");
  }
  const base = `https://cloudkms.googleapis.com/v1/${keyName}`;

  async function call(op: "encrypt" | "decrypt", body: Record<string, string>) {
    const token = await getVaultAccessToken();
    const res = await fetch(`${base}:${op}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Never echo the response body: on decrypt it is the data key.
    if (!res.ok) throw new Error(`Cloud KMS ${op} failed ${res.status}`);
    return (await res.json()) as { name?: string; ciphertext?: string; plaintext?: string };
  }

  return {
    async wrap(dek, aad) {
      const out = await call("encrypt", {
        plaintext: dek.toString("base64"),
        additionalAuthenticatedData: aad.toString("base64"),
      });
      if (!out.ciphertext || !out.name) throw new Error("Cloud KMS encrypt returned no ciphertext");
      // `name` is the exact key version KMS used, which is what makes a
      // later rotation auditable row by row.
      return { wrapped: Buffer.from(out.ciphertext, "base64"), kekRef: `kms:${out.name}` };
    },
    async unwrap(wrapped, kekRef, aad) {
      if (!kekRef.startsWith(`kms:${keyName}/cryptoKeyVersions/`)) throw new VaultKeyMismatchError();
      const out = await call("decrypt", {
        ciphertext: wrapped.toString("base64"),
        additionalAuthenticatedData: aad.toString("base64"),
      });
      if (!out.plaintext) throw new Error("Cloud KMS decrypt returned no plaintext");
      return Buffer.from(out.plaintext, "base64");
    },
  };
}

// ── Environment key ───────────────────────────────────────────────────

/// A key that is not 32 bytes, or is one of the well-known test values,
/// is refused in production rather than used. The CI key is in a public
/// workflow file.
const PUBLIC_TEST_KEYS = new Set(["Y2ktb25seS12YXVsdC1rZXktbm90LWEtc2VjcmV0ISE="]);

function envProvider(kekB64: string): KeyProvider {
  if (isProductionDeployment() && PUBLIC_TEST_KEYS.has(kekB64.trim())) {
    throw new VaultUnavailableError("VAULT_KEK בפרודקשן הוא מפתח הבדיקה הציבורי.");
  }
  const kek = Buffer.from(kekB64, "base64");
  if (kek.length !== 32) throw new VaultUnavailableError("VAULT_KEK חייב להיות 32 בתים בקידוד base64.");
  // A fingerprint, not the key: the first 64 bits of its SHA-256. Enough
  // to tell two environments' keys apart, useless for recovering either.
  const ref = `env:${createHash("sha256").update(kek).digest("hex").slice(0, 16)}`;

  return {
    async wrap(dek, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", kek, iv);
      cipher.setAAD(aad);
      const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
      return { wrapped: Buffer.concat([iv, cipher.getAuthTag(), ct]), kekRef: ref };
    },
    async unwrap(wrapped, kekRef, aad) {
      if (kekRef !== ref) throw new VaultKeyMismatchError();
      const decipher = createDecipheriv("aes-256-gcm", kek, wrapped.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(wrapped.subarray(12, 28));
      return Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]);
    },
  };
}

// ── Selection ─────────────────────────────────────────────────────────

/// Read at call time, not module load, so tests can switch environments.
function provider(): KeyProvider {
  const kmsKey = process.env.GCP_VAULT_KMS_KEY;
  if (kmsKey) return kmsProvider(kmsKey);
  const envKey = process.env.VAULT_KEK;
  if (envKey) return envProvider(envKey);
  throw new VaultUnavailableError();
}

/// Whether this environment can encrypt at all. The screen uses it to
/// say "not configured yet" in words instead of failing on save.
export function isVaultConfigured(): boolean {
  try {
    provider();
    return true;
  } catch {
    return false;
  }
}

export async function wrapDataKey(dek: Buffer, aad: Buffer): Promise<WrappedKey> {
  return provider().wrap(dek, aad);
}

export async function unwrapDataKey(wrapped: Buffer, kekRef: string, aad: Buffer): Promise<Buffer> {
  return provider().unwrap(wrapped, kekRef, aad);
}
