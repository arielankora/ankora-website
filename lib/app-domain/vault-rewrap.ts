import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { credentialAad, openSecret } from "@/lib/vault/crypto";
import { isVaultConfigured, kekRefStatus, unwrapDataKey, wrapDataKey } from "@/lib/vault/keys";
import { sendVaultAlert } from "@/lib/vault/alerts";

// Moves every credential row onto the key that currently writes
// (lib/vault/keys.ts, "Selection"). Runs nightly from its own cron; on a
// quiet night it reads the rows' key references and writes nothing.
//
// Only the wrapped data key changes. The row's secret stays exactly as it
// was: same ciphertext, same IV, same tag. That is what makes this safe to
// run on live data, and cheap.
//
// Each row, before anything is written:
//   1. the data key is unwrapped with the old key,
//   2. the secret is actually opened with it, so a row that is already
//      broken is reported and left alone, never re-wrapped into a state
//      that looks healthy,
//   3. the data key is wrapped with the new key and unwrapped back, and
//      must come out identical.
// The write is conditional on the row still carrying the old reference,
// so an edit that lands mid-run wins and the row is simply skipped.
// Nothing here logs, returns or emails a secret: ids and counts only.

export interface RewrapResult {
  configured: boolean;
  total: number;
  current: number;
  rewrapped: number;
  /** On a key this environment does not hold. Not touched. */
  foreign: number;
  /** Failed a check above. Not touched; ids go to the audit log. */
  failed: number;
  /** Changed by someone else during the run. Picked up next time. */
  skipped: number;
}

const SELECT = {
  id: true,
  clientId: true,
  secretCiphertext: true,
  secretIv: true,
  secretTag: true,
  wrappedDek: true,
  kekRef: true,
} as const;

export async function rewrapVaultKeys(): Promise<RewrapResult> {
  const result: RewrapResult = { configured: isVaultConfigured(), total: 0, current: 0, rewrapped: 0, foreign: 0, failed: 0, skipped: 0 };
  if (!result.configured) return result;

  // Soft-deleted rows too: until they are purged they hold ciphertext, and
  // a row left on a retired key would be unreadable for good.
  const rows = await prisma.clientCredential.findMany({
    where: { wrappedDek: { not: null }, kekRef: { not: null } },
    select: SELECT,
  });
  result.total = rows.length;

  const failedIds: string[] = [];
  const foreignRefs = new Set<string>();
  let newRef: string | null = null;

  for (const row of rows) {
    const oldRef = row.kekRef!;
    const status = kekRefStatus(oldRef);
    if (status === "current") {
      result.current++;
      continue;
    }
    if (status === "foreign") {
      result.foreign++;
      foreignRefs.add(oldRef);
      continue;
    }

    const aad = credentialAad(row.id, row.clientId);
    let dek: Buffer | null = null;
    let check: Buffer | null = null;
    try {
      dek = await unwrapDataKey(Buffer.from(row.wrappedDek!), oldRef, aad);
      if (row.secretCiphertext && row.secretIv && row.secretTag) {
        // Opened only to prove the row is whole; the result is dropped at once.
        openSecret(
          { ciphertext: Buffer.from(row.secretCiphertext), iv: Buffer.from(row.secretIv), tag: Buffer.from(row.secretTag) },
          dek,
          aad,
        );
      }
      const next = await wrapDataKey(dek, aad);
      check = await unwrapDataKey(next.wrapped, next.kekRef, aad);
      if (!check.equals(dek)) throw new Error("round trip mismatch");

      const updated = await prisma.clientCredential.updateMany({
        where: { id: row.id, kekRef: oldRef },
        data: { wrappedDek: next.wrapped, kekRef: next.kekRef },
      });
      if (updated.count === 1) {
        result.rewrapped++;
        newRef = next.kekRef;
      } else {
        result.skipped++;
      }
    } catch {
      result.failed++;
      failedIds.push(row.id);
    } finally {
      dek?.fill(0);
      check?.fill(0);
    }
  }

  if (result.rewrapped > 0 || result.failed > 0) {
    await recordAudit({
      actorId: null,
      action: "vault.rewrap",
      entityType: "ClientCredential",
      after: { ...result, newKekRef: newRef, failedIds },
      ip: null,
      userAgent: null,
    });
    const lines = [
      `הועברו למפתח החדש: ${result.rewrapped}`,
      `כבר על המפתח החדש: ${result.current}`,
      `נכשלו בבדיקה ולא נגעו בהן: ${result.failed}`,
      `רשומות במפתח שהסביבה לא מחזיקה: ${result.foreign}`,
    ];
    const done = result.failed === 0 && result.skipped === 0 && result.foreign === 0;
    await sendVaultAlert(
      done ? "החלפת המפתח הושלמה" : "החלפת המפתח לא הושלמה",
      done
        ? [...lines, "", "אפשר להעביר את הערך החדש ל-VAULT_KEK, למחוק את VAULT_KEK_NEXT ולפרוס מחדש."]
        : [...lines, "", "אל תמחקו את המפתח הישן עד שהמספרים האלה יתאפסו."],
    );
  } else if (result.foreign > 0) {
    // Logged, not mailed: a preview copied from production sees this
    // every night, and a nightly email would teach everyone to ignore it.
    console.warn("[vault-rewrap] rows on a key this environment does not hold", {
      count: result.foreign,
      refs: [...foreignRefs],
    });
  }

  return result;
}
