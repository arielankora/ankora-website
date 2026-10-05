/// The mechanism that keeps the backup from falling behind the schema.
///
/// The previous dump listed six tables by hand and the schema grew to
/// thirty-six around it. Nothing failed, nothing warned, and the gap was
/// only visible to somebody who sat down and compared the two lists.
/// These tests are that comparison, run on every commit: they read
/// prisma/schema.prisma itself, so the question "is this model in the
/// backup" is answered by the build rather than by memory.
///
/// A failure here is not a broken test. It is the build asking a
/// question that has to be answered once per new model: does this table
/// belong in the backup, and if not, how is its content regained after
/// a restore.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_COVERAGE,
  ACKNOWLEDGED_SENSITIVE_COLUMNS,
  SENSITIVE_COLUMN_PATTERN,
  DUMP_SIZE_WARN_BYTES,
  DUMP_EMAIL_ATTACH_MAX_BYTES,
  dumpedTables,
  skippedTables,
} from "@/lib/app-domain/backup-coverage";

interface ParsedModel {
  name: string;
  table: string;
  fields: string[];
}

function parseSchema(): ParsedModel[] {
  const src = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const models: ParsedModel[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, name, body] = m;
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    const fields: string[] = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("///") || line.startsWith("@@")) continue;
      const f = line.match(/^(\w+)\s+(\w+)/);
      if (!f) continue;
      // Relation fields are not columns. A relation's type is another
      // model; a scalar's is a Prisma scalar or an enum, both of which
      // are lower-case-insensitive here only by convention, so match on
      // the model list instead - done by the caller, after parsing.
      fields.push(`${f[1]}:${f[2]}`);
    }
    models.push({ name, table: mapped ? mapped[1] : name, fields });
  }
  return models;
}

const models = parseSchema();
const modelNames = new Set(models.map((m) => m.name));

/// Column-backed fields only: drop the ones whose type is another model.
function scalarFields(m: ParsedModel): string[] {
  return m.fields
    .map((f) => f.split(":"))
    .filter(([, type]) => !modelNames.has(type.replace(/[[\]?]/g, "")))
    .map(([name]) => name);
}

describe("backup coverage keeps up with the schema", () => {
  it("parses the schema it is meant to guard", () => {
    // If this ever reads zero models the rest of the file would pass
    // while checking nothing at all.
    expect(models.length).toBeGreaterThan(30);
  });

  it("has a decision for every model in the schema", () => {
    const undecided = models.map((m) => m.name).filter((n) => !BACKUP_COVERAGE[n]);
    expect(
      undecided,
      `New model(s) with no backup decision: ${undecided.join(", ")}. ` +
        `Add each to BACKUP_COVERAGE in lib/app-domain/backup-coverage.ts - DUMP with a reason, ` +
        `or SKIP with a reason AND how the data is regained after a restore.`
    ).toEqual([]);
  });

  it("has no decision for a model that no longer exists", () => {
    const stale = Object.keys(BACKUP_COVERAGE).filter((n) => !modelNames.has(n));
    expect(stale, `Coverage entries for models that are gone: ${stale.join(", ")}`).toEqual([]);
  });

  it("points every decision at the table Prisma actually writes to", () => {
    for (const m of models) {
      expect(BACKUP_COVERAGE[m.name].table, `${m.name} maps to "${m.table}"`).toBe(m.table);
    }
  });

  it("redacts only columns that exist", () => {
    for (const m of models) {
      const c = BACKUP_COVERAGE[m.name];
      if (c.decision !== "DUMP" || !c.redact) continue;
      const fields = scalarFields(m);
      for (const col of Object.keys(c.redact)) {
        expect(fields, `${m.name}.${col} is redacted but is not a column`).toContain(col);
      }
    }
  });

  it("makes every skip name its recovery path", () => {
    for (const [name, c] of Object.entries(BACKUP_COVERAGE)) {
      if (c.decision !== "SKIP") continue;
      expect(c.reason.length, `${name} needs a reason`).toBeGreaterThan(20);
      expect(c.recovery.length, `${name} needs a recovery path`).toBeGreaterThan(20);
    }
  });

  // This is the guard that matters most in practice. The dump selects
  // every column of every covered table, so a column added tomorrow
  // rides along to Google Drive and to two inboxes without anyone
  // choosing that. If its name looks like a credential, the build stops
  // and asks.
  it("lets no new credential-shaped column into the dump unnoticed", () => {
    const offenders: string[] = [];
    for (const m of models) {
      const c = BACKUP_COVERAGE[m.name];
      if (c.decision !== "DUMP") continue;
      for (const col of scalarFields(m)) {
        if (!SENSITIVE_COLUMN_PATTERN.test(col)) continue;
        if (c.redact && col in c.redact) continue;
        if (ACKNOWLEDGED_SENSITIVE_COLUMNS[`${c.table}.${col}`]) continue;
        offenders.push(`${c.table}.${col}`);
      }
    }
    expect(
      offenders,
      `Column(s) whose name suggests a credential are being dumped: ${offenders.join(", ")}. ` +
        `Either add the column to that model's \`redact\` list, or record why it is safe in ` +
        `ACKNOWLEDGED_SENSITIVE_COLUMNS.`
    ).toEqual([]);
  });

  it("keeps no stale acknowledgement of a column that is gone", () => {
    const live = new Set<string>();
    for (const m of models) {
      const c = BACKUP_COVERAGE[m.name];
      for (const col of scalarFields(m)) live.add(`${c.table}.${col}`);
    }
    const stale = Object.keys(ACKNOWLEDGED_SENSITIVE_COLUMNS).filter((k) => !live.has(k));
    expect(stale, `Acknowledgements for columns that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  it("covers the tables the old six-table dump was missing", () => {
    // Regression, named explicitly: these two are why the dump could not
    // do what it said it did.
    expect(dumpedTables()).toContain("billing_policies");
    expect(dumpedTables()).toContain("hour_bank_adjustments");
    expect(dumpedTables()).toContain("client_documents");
    expect(dumpedTables()).toContain("user_client_access");
  });

  it("dumps no table that holds a credential hash", () => {
    for (const t of ["password_reset_tokens", "portal_login_tokens", "mcp_access_tokens", "oauth_tokens", "oauth_authorization_codes", "oauth_clients"]) {
      expect(skippedTables(), `${t} must stay out of a file that leaves the database`).toContain(t);
    }
  });

  it("warns about size before it refuses to email it", () => {
    expect(DUMP_SIZE_WARN_BYTES).toBeLessThan(DUMP_EMAIL_ATTACH_MAX_BYTES);
  });
});
