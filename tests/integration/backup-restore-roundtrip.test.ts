/// The test that makes the nightly dump a backup rather than a file.
///
/// Everything else in this feature is an assertion about intent: the
/// coverage map says which tables matter, the size guard says when the
/// design runs out, the unit test says nobody added a model without
/// deciding. None of that proves the one thing that is actually
/// promised, which is that when the database is gone, this file brings
/// it back.
///
/// So: fill every table in the schema, take a dump, destroy all the
/// data, run the real restore script the way a human would run it, and
/// compare the database to what it was, row for row and column for
/// column.
///
/// Three properties worth naming, because each is a bug this test has
/// to be able to catch:
///
///   - The fixture is generated from the database catalog, so a table
///     added next year is covered here without anyone remembering to
///     come back.
///   - The restore runs as a child process against
///     `scripts/restore-from-dump.mjs`, not as an imported function.
///     The operator path and the tested path are the same path.
///   - Redaction is asserted in both directions: passwordHash has a
///     value before the dump and is null after the restore. A test that
///     only checks "equal" would pass if the column were empty all along.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { buildDump } from "@/lib/app-domain/backup-dump";
import { dumpedTables, skippedTables, REDACTED_PASSWORD_HASH } from "@/lib/app-domain/backup-coverage";
import { tableColumns, foreignKeys, enumLabels, topoSort, fixtureValue } from "./pg-catalog";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const ROWS_PER_TABLE = 3;

// Read `timestamp without time zone` as UTC, the way Prisma does in the
// app. node-postgres reads it in the process's local zone by default, so
// under the CI's TZ=Asia/Jerusalem the dump this test builds through
// plain `pg` came out shifted by the zone offset and the round trip
// failed, while it passed under UTC. Production builds the dump through
// Prisma, and the restore script only writes, so neither had the bug;
// this test's own reader did. Process-wide on purpose: the dump and both
// snapshots must read the same way.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (s: string) => new Date(`${s.replace(" ", "T")}Z`));

function normalize(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return v.toString("base64");
  if (Array.isArray(v)) return v.map(normalize);
  return v;
}

async function snapshot(db: pg.Client, tables: string[]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const r = await db.query(`SELECT * FROM "${t}" ORDER BY "id"`);
    out[t] = r.rows.map((row: Record<string, unknown>) => {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(row).sort()) o[k] = normalize(row[k]);
      return o;
    });
  }
  return out;
}

describe.skipIf(!DATABASE_URL)("nightly dump restores the database it came from", () => {
  let db: pg.Client;
  let allTables: string[] = [];
  let workDir: string;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DATABASE_URL });
    await db.connect();
    workDir = mkdtempSync(path.join(tmpdir(), "ankora-restore-"));

    const r = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name <> '_prisma_migrations'`
    );
    const names = r.rows.map((x: { table_name: string }) => x.table_name);
    const fks = await foreignKeys(db);
    allTables = topoSort(
      names,
      fks.map((f) => [f.child, f.parent] as [string, string])
    );
  }, 60_000);

  afterAll(async () => {
    // Leave the shared integration database the way every other file in
    // this directory expects to find it: migrated and empty.
    if (db) {
      if (allTables.length) {
        await db.query(`TRUNCATE TABLE ${allTables.map((t) => `"${t}"`).join(", ")} CASCADE`);
      }
      await db.end();
    }
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("restores every covered table, and only the covered tables", async () => {
    const wipe = async () =>
      db.query(`TRUNCATE TABLE ${allTables.map((t) => `"${t}"`).join(", ")} CASCADE`);

    // --- fill the whole schema -------------------------------------------
    await wipe();
    const enums = await enumLabels(db);
    const fks = await foreignKeys(db);
    const fkTarget = new Map(
      fks.map((f) => [`${f.child}.${f.column}`, { parent: f.parent, parentColumn: f.parentColumn }])
    );
    // Column values per table, because a foreign key may reference any
    // unique column, not only the primary key.
    const valuesByTable = new Map<string, Map<string, unknown[]>>();

    for (const table of allTables) {
      const cols = (await tableColumns(db, table)).filter((c) => !c.isIdentity);
      const columnValues = new Map<string, unknown[]>(cols.map((c) => [c.name, []]));
      for (let i = 0; i < ROWS_PER_TABLE; i++) {
        const values = cols.map((c) =>
          fixtureValue(table, c, i, enums, fkTarget.get(`${table}.${c.name}`), valuesByTable)
        );
        const placeholders = cols.map((c, idx) => {
          const udt = c.udt;
          return udt === "json" || udt === "jsonb" ? `$${idx + 1}::jsonb` : `$${idx + 1}`;
        });
        const prepared = values.map((v, idx) =>
          cols[idx].udt === "json" || cols[idx].udt === "jsonb" ? JSON.stringify(v) : v
        );
        await db.query(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES (${placeholders.join(", ")})`,
          prepared
        );
        cols.forEach((c, idx) => columnValues.get(c.name)!.push(values[idx]));
      }
      valuesByTable.set(table, columnValues);
    }

    // Every table in the schema now has rows. If it does not, the
    // comparison below would be vacuously true for that table.
    for (const table of allTables) {
      const c = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(c.rows[0].n, `${table} was not seeded`).toBe(ROWS_PER_TABLE);
    }

    // --- dump -------------------------------------------------------------
    const exec = { query: async <T>(sql: string) => (await db.query(sql)).rows as T[] };
    const dump = await buildDump(exec);
    expect(dump.problems).toEqual([]);
    expect(Object.keys(dump.tables).sort()).toEqual(dumpedTables());

    const before = await snapshot(db, dumpedTables());
    const realHashes = await db.query(
      `SELECT count(*)::int AS n FROM users WHERE "passwordHash" NOT LIKE 'REDACTED%'`
    );
    expect(realHashes.rows[0].n, "fixture must set a real passwordHash, or redaction proves nothing").toBe(ROWS_PER_TABLE);

    const dumpPath = path.join(workDir, "ankora-database-dump-test.json.gz");
    writeFileSync(dumpPath, gzipSync(Buffer.from(JSON.stringify(dump))));

    // --- lose everything ---------------------------------------------------
    await wipe();
    for (const table of allTables) {
      const c = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(c.rows[0].n, `${table} should be empty before the restore`).toBe(0);
    }

    // --- restore, through the operator's own command ------------------------
    const out = execFileSync(
      process.execPath,
      ["scripts/restore-from-dump.mjs", "--file", dumpPath, "--database-url", DATABASE_URL!],
      { encoding: "utf8", cwd: process.cwd() }
    );
    expect(out).toContain("Restored from");

    // --- compare ------------------------------------------------------------
    const after = await snapshot(db, dumpedTables());
    for (const table of dumpedTables()) {
      // passwordHash is the one column that is meant NOT to survive, and
      // it is asserted separately below.
      const strip = (rows: unknown[]) =>
        table === "users"
          ? rows.map((r) => {
              const { passwordHash: _ignored, ...rest } = r as Record<string, unknown>;
              return rest;
            })
          : rows;
      expect(strip(after[table]), `${table} did not come back the way it went in`).toEqual(strip(before[table]));
    }

    // Skipped tables are empty, and that is the intended outcome, not a
    // failure: their rows are credentials that get re-issued.
    for (const table of skippedTables()) {
      const c = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(c.rows[0].n, `${table} is marked SKIP and must not come back`).toBe(0);
    }

    // Redaction: the rows are back, the hashes are not. passwordHash is
    // NOT NULL, so the dump carries a placeholder rather than null - the
    // restore would fail outright otherwise, which is how this was found.
    const users = await db.query(`SELECT count(*)::int AS n FROM users`);
    expect(users.rows[0].n).toBe(ROWS_PER_TABLE);
    const hashes = await db.query(`SELECT DISTINCT "passwordHash" AS h FROM users`);
    expect(hashes.rows.map((r: { h: string }) => r.h)).toEqual([REDACTED_PASSWORD_HASH]);
  }, 180_000);

  it("refuses a dump taken against a different schema version", async () => {
    const exec = { query: async <T>(sql: string) => (await db.query(sql)).rows as T[] };
    const dump = await buildDump(exec);
    const tampered = { ...dump, schemaMigration: "20200101000000_from_another_lifetime" };
    const p = path.join(workDir, "wrong-schema.json");
    writeFileSync(p, JSON.stringify(tampered));

    expect(() =>
      execFileSync(process.execPath, ["scripts/restore-from-dump.mjs", "--file", p, "--database-url", DATABASE_URL!], {
        encoding: "utf8",
        stdio: "pipe",
      })
    ).toThrow();
  }, 60_000);
});
