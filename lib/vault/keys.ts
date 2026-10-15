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
  /** Whether a row's kekRef was written by this key. */
  owns(kekRef: string): boolean;
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

  const prefix = `kms:${keyName}/cryptoKeyVersions/`;

  return {
    // Every version of the same KMS key: KMS itself picks the version a
    // ciphertext was made with, so a rotation inside KMS needs no re-wrap.
    owns: (kekRef) => kekRef.startsWith(prefix),
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
      if (!kekRef.startsWith(prefix)) throw new VaultKeyMismatchError();
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

function envProvider(kekB64: string, name = "VAULT_KEK"): KeyProvider {
  if (isProductionDeployment() && PUBLIC_TEST_KEYS.has(kekB64.trim())) {
    throw new VaultUnavailableError(`${name} בפרודקשן הוא מפתח הבדיקה הציבורי.`);
  }
  const kek = Buffer.from(kekB64, "base64");
  if (kek.length !== 32) throw new VaultUnavailableError(`${name} חייב להיות 32 בתים בקידוד base64.`);
  // A fingerprint, not the key: the first 64 bits of its SHA-256. Enough
  // to tell two environments' keys apart, useless for recovering either.
  const ref = `env:${createHash("sha256").update(kek).digest("hex").slice(0, 16)}`;

  return {
    owns: (kekRef) => kekRef === ref,
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
//
// Rotation (runbook: "החלפת מפתח הכספת"). Every key the environment holds
// can open the rows it wrapped; only the newest one writes:
//
//   GCP_VAULT_KMS_KEY  >  VAULT_KEK_NEXT  >  VAULT_KEK
//
// To rotate the environment key without reading the old one back (it is a
// sensitive variable, so nobody can): add the new value as VAULT_KEK_NEXT
// and redeploy. New writes go to it at once, and the nightly re-wrap job
// (lib/app-domain/vault-rewrap.ts) moves every existing row onto it. When
// the job reports nothing left, put the same new value in VAULT_KEK,
// delete VAULT_KEK_NEXT and redeploy. Moving to Cloud KMS is the same
// procedure with GCP_VAULT_KMS_KEY in place of VAULT_KEK_NEXT.

interface KeyRing {
  writer: KeyProvider;
  readers: KeyProvider[];
}

/// Read at call time, not module load, so tests can switch environments.
function keyRing(): KeyRing {
  const candidates: [string | undefined, () => KeyProvider][] = [
    [process.env.GCP_VAULT_KMS_KEY, () => kmsProvider(process.env.GCP_VAULT_KMS_KEY!)],
    [process.env.VAULT_KEK_NEXT, () => envProvider(process.env.VAULT_KEK_NEXT!, "VAULT_KEK_NEXT")],
    [process.env.VAULT_KEK, () => envProvider(process.env.VAULT_KEK!)],
  ];
  const readers: KeyProvider[] = [];
  for (const [value, build] of candidates) {
    if (!value) continue;
    if (readers.length === 0) {
      // The writer must be valid: a bad key there is a refusal, not a
      // fallback to an older key.
      readers.push(build());
      continue;
    }
    // An older key that does not build (say, the public CI value left in
    // VAULT_KEK beside a production KMS key) simply opens nothing.
    try {
      readers.push(build());
    } catch {
      /* skipped on purpose */
    }
  }
  if (readers.length === 0) throw new VaultUnavailableError();
  return { writer: readers[0], readers };
}

/// Whether this environment can encrypt at all. The screen uses it to
/// say "not configured yet" in words instead of failing on save.
export function isVaultConfigured(): boolean {
  try {
    keyRing();
    return true;
  } catch {
    return false;
  }
}

export async function wrapDataKey(dek: Buffer, aad: Buffer): Promise<WrappedKey> {
  return keyRing().writer.wrap(dek, aad);
}

export async function unwrapDataKey(wrapped: Buffer, kekRef: string, aad: Buffer): Promise<Buffer> {
  const owner = keyRing().readers.find((p) => p.owns(kekRef));
  if (!owner) throw new VaultKeyMismatchError();
  return owner.unwrap(wrapped, kekRef, aad);
}

/// Where a row stands against this environment's keys: already on the
/// key that writes ("current"), on an older key this environment still
/// holds ("stale", so the re-wrap job can move it), or on a key it does
/// not hold at all ("foreign": another environment's row, or a key that
/// was removed too early).
export function kekRefStatus(kekRef: string): "current" | "stale" | "foreign" {
  const ring = keyRing();
  if (ring.writer.owns(kekRef)) return "current";
  return ring.readers.some((p) => p.owns(kekRef)) ? "stale" : "foreign";
}
