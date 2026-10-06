import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getVaultAccessToken } from "./gcp-token";
import { isProductionDeployment } from "@/lib/env";

// Credentials vault, the key-encryption half (decision 1, 6.10.2026).
//
// Wraps and unwraps each row's data key. Two providers, chosen by
// environment, never mixed:
//
//   * Cloud KMS (GCP_VAULT_KMS_KEY set). Production. The key-encryption
//     key lives in KMS and never leaves it; this module only ever sends a
//     32-byte data key to be wrapped, or a wrapped one to be unwrapped.
//     A database dump plus every environment variable in Vercel is still
//     not enough to read a password. That is the property the spec chose
//     KMS for.
//
//   * Local key (VAULT_LOCAL_KEK, base64 of 32 bytes). Development, tests
//     and preview deployments. REFUSED in production, in code, so a
//     misconfigured production deploy fails loudly instead of quietly
//     storing client passwords under a key that sits in an env var.
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

// ── Local key (never production) ──────────────────────────────────────

function localProvider(kekB64: string): KeyProvider {
  const kek = Buffer.from(kekB64, "base64");
  if (kek.length !== 32) throw new VaultUnavailableError("VAULT_LOCAL_KEK חייב להיות 32 בתים בקידוד base64.");
  const ref = `local:${createHash("sha256").update(kek).digest("hex").slice(0, 16)}`;

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
  if (isProductionDeployment()) {
    // The one configuration this file exists to prevent.
    throw new VaultUnavailableError();
  }
  const local = process.env.VAULT_LOCAL_KEK;
  if (local) return localProvider(local);
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
