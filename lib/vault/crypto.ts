import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Credentials vault, the symmetric half (claude/credentials-vault-spec-2026-10-06.md).
//
// Envelope encryption: each credential row gets its own random 256-bit
// data key (DEK). The row's secrets (username, password, notes) are one
// JSON document, encrypted once with AES-256-GCM under that DEK. The DEK
// is then wrapped by the key-encryption key in lib/vault/keys.ts, which in
// production never leaves Cloud KMS. What the database stores is the
// ciphertext, the IV, the GCM tag and the wrapped DEK. None of it is
// usable without a call to KMS.
//
// The AAD (additional authenticated data) binds every ciphertext to the
// row it was written for: `ankora.credential.v1|<id>|<clientId>`. GCM
// authenticates it without encrypting it, so copying one client's
// ciphertext onto another client's row - by a bug, or by someone with
// write access to the database - fails to decrypt instead of quietly
// handing client B's bank password to whoever is assigned to client A.
// The same AAD is passed to KMS when wrapping the DEK, so the wrapped key
// is bound to the row too.
//
// No dependency: node:crypto only.

export const ENC_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;

export interface CredentialSecret {
  username: string | null;
  password: string | null;
  notes: string | null;
}

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function credentialAad(credentialId: string, clientId: string): Buffer {
  return Buffer.from(`ankora.credential.v${ENC_VERSION}|${credentialId}|${clientId}`, "utf8");
}

export function generateDataKey(): Buffer {
  return randomBytes(32);
}

export function sealSecret(secret: CredentialSecret, dek: Buffer, aad: Buffer): SealedSecret {
  if (dek.length !== 32) throw new Error("Vault data key must be 32 bytes.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify(secret), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  plaintext.fill(0);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function openSecret(sealed: SealedSecret, dek: Buffer, aad: Buffer): CredentialSecret {
  if (dek.length !== 32) throw new Error("Vault data key must be 32 bytes.");
  const decipher = createDecipheriv(ALGORITHM, dek, sealed.iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  // final() throws if the tag, the AAD or the bytes do not match. That is
  // the whole point; callers turn it into a refusal, never a retry.
  const plaintext = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<CredentialSecret>;
  plaintext.fill(0);
  return {
    username: typeof parsed.username === "string" ? parsed.username : null,
    password: typeof parsed.password === "string" ? parsed.password : null,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
  };
}
