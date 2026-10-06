import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Structural guards for the credentials vault
// (claude/credentials-vault-spec-2026-10-06.md). Each one is a rule the
// spec states as permanent, checked by reading the source rather than by
// trusting whoever writes the next screen. Same shape as
// audit-labels.test.ts and task-close-rule.test.ts.

const ROOT = join(__dirname, "..", "..");

function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) files(rel, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(rel);
  }
  return acc;
}

const SOURCE = [...files("app"), ...files("lib"), ...files("components")];
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("credentials vault guards", () => {
  it("returns plain text from exactly one route", () => {
    const callers = SOURCE.filter((f) => /\brevealCredential\s*\(/.test(read(f)));
    expect(callers.sort()).toEqual(["app/api/credentials/[id]/reveal/route.ts", "lib/app-domain/credentials.ts"]);
  });

  it("touches the secret columns only inside the domain module", () => {
    const touching = SOURCE.filter((f) => /secretCiphertext|wrappedDek/.test(read(f)));
    // backup-coverage.ts names them only to record why dumping the
    // ciphertext is safe; the dump copies rows without reading meaning
    // into any column.
    expect(touching.sort()).toEqual(["lib/app-domain/backup-coverage.ts", "lib/app-domain/credentials.ts"]);
  });

  it("gives Claude (MCP) no route to the vault at all", () => {
    const mcp = SOURCE.filter((f) => f.startsWith("lib/mcp/") || f.startsWith("app/api/mcp/"));
    expect(mcp.length).toBeGreaterThan(0);
    for (const f of mcp) {
      expect(read(f), relative(ROOT, f)).not.toMatch(/clientCredential|app-domain\/credentials|lib\/vault/);
    }
  });

  it("keeps the vault out of the nightly backup's human-readable workbook", () => {
    // The JSON dump may one day include the table - as ciphertext, which
    // is safe without KMS. The XLSX is for reading, and must never.
    const backup = read("lib/app-domain/backup-export.ts") + read("lib/app-domain/backup-export-format.ts");
    expect(backup).not.toMatch(/clientCredential|client_credentials/);
  });

  it("never logs inside the reveal route", () => {
    expect(read("app/api/credentials/[id]/reveal/route.ts")).not.toMatch(/console\.|logger\./);
  });
});
