/// Builds the nightly JSON dump from whatever the coverage map says to
/// dump (lib/app-domain/backup-coverage.ts), rather than from a list
/// written by hand inside this file.
///
/// Two design choices here are deliberate and worth defending, because
/// both look like extra work from the outside:
///
/// **It reads the live database catalog, not the Prisma schema.** The
/// column list for each table comes from `information_schema`, so a
/// column added by a migration is in the backup the same night, without
/// anyone remembering to add it. The Prisma client would do this too,
/// but only for the shape it was generated against.
///
/// **It talks to the database through an injected executor, not through
/// the Prisma client directly.** In the app the executor is Prisma
/// (`$queryRawUnsafe`). In the round-trip test it is a plain `pg`
/// connection. That is not test convenience: it is what lets
/// `tests/integration/backup-restore-roundtrip.test.ts` prove the dump
/// restores, in an environment where the Prisma client is not
/// generated - the same environment you are in on the day you actually
/// need the restore, when the thing that broke may well BE the build.
///
/// Identifiers are interpolated into SQL here. They come from this
/// repo's own coverage map and from the database catalog, never from a
/// request, and they are quoted. There is no user input on this path.

import {
  BACKUP_COVERAGE,
  dumpedTables,
  redactionsByTable,
} from "@/lib/app-domain/backup-coverage";

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export interface DumpTable {
  columns: string[];
  /// Column -> the value written in place of the real one. The real
  /// value is never selected out of the database, so it is not in this
  /// process's memory either, let alone in the file.
  redacted: Record<string, string | null>;
  rowCount: number;
  /// Row-major, aligned to `columns`. Arrays rather than objects: the
  /// column names are written once instead of once per row, which on
  /// this data is a large part of the compressed size.
  rows: unknown[][];
}

export interface Dump {
  format: 2;
  generatedAt: string;
  /// The last migration applied to the source database. The restore
  /// script refuses to load a dump into a database at a different
  /// migration unless explicitly told to, because a dump and a schema
  /// that disagree is how a restore silently loses a column.
  schemaMigration: string | null;
  tables: Record<string, DumpTable>;
  skipped: Record<string, { reason: string; recovery: string }>;
  /// Anything that went wrong while building the dump but did not stop
  /// it. Empty is the expected state; non-empty is a real signal and the
  /// nightly job logs it.
  problems: string[];
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to build SQL with an unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

/// JSON has no date type and no opinion about bigint. Everything the
/// restore has to put back has to survive this function and
/// `JSON.parse` unchanged.
///
/// Bytes: Prisma 6 hands a bytea column back as a plain Uint8Array, not a
/// Buffer, and `Buffer.isBuffer` is false for it - the value would have
/// been written as `{"0":12,"1":201,...}` and restored as JSON into a
/// bytea column, which fails. No table had a bytea column until the
/// credentials vault (6.10.2026); its ciphertext is the first. A Buffer
/// is a Uint8Array, so this one check covers both.
export function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return { __bytes_b64: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64") };
  if (Array.isArray(v)) return v.map(normalizeValue);
  return v;
}

interface CatalogColumn {
  table_name: string;
  column_name: string;
}

interface CatalogPk {
  table_name: string;
  column_name: string;
}

export async function buildDump(exec: SqlExecutor, now: Date = new Date()): Promise<Dump> {
  const wanted = dumpedTables();
  const problems: string[] = [];
  const inList = wanted.map((t) => `'${t}'`).join(",");

  const columnRows = await exec.query<CatalogColumn>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN (${inList})
     ORDER BY table_name, ordinal_position`
  );

  const pkRows = await exec.query<CatalogPk>(
    `SELECT c.relname AS table_name, a.attname AS column_name
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN LATERAL unnest(con.conkey) WITH ORDINALITY k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
     WHERE con.contype = 'p' AND c.relnamespace = 'public'::regnamespace
       AND c.relname IN (${inList})
     ORDER BY c.relname, k.ord`
  );

  const columnsByTable = new Map<string, string[]>();
  for (const r of columnRows) {
    const list = columnsByTable.get(r.table_name) ?? [];
    list.push(r.column_name);
    columnsByTable.set(r.table_name, list);
  }

  const pkByTable = new Map<string, string[]>();
  for (const r of pkRows) {
    const list = pkByTable.get(r.table_name) ?? [];
    list.push(r.column_name);
    pkByTable.set(r.table_name, list);
  }

  let schemaMigration: string | null = null;
  try {
    const mig = await exec.query<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY finished_at DESC LIMIT 1`
    );
    schemaMigration = mig[0]?.migration_name ?? null;
  } catch {
    // A database without Prisma's migration table is still dumpable;
    // the restore just cannot check that the schemas agree.
    problems.push("Could not read _prisma_migrations; the dump carries no schema version.");
  }

  const redactions = redactionsByTable();
  const tables: Record<string, DumpTable> = {};

  for (const table of wanted) {
    const columns = columnsByTable.get(table);
    if (!columns || columns.length === 0) {
      // A coverage entry pointing at a table that is not in the
      // database. Usually a rename that only reached one of the two.
      problems.push(`Table "${table}" is in the coverage map but not in the database; nothing was dumped for it.`);
      continue;
    }

    const declared = redactions[table] ?? {};
    const redacted: Record<string, string | null> = {};
    for (const [col, placeholder] of Object.entries(declared)) {
      if (columns.includes(col)) redacted[col] = placeholder;
      else problems.push(`Redaction "${table}.${col}" no longer matches a column; the redaction had no effect.`);
    }

    const selectList = columns
      .map((c) => (c in redacted ? `NULL AS ${quoteIdent(c)}` : quoteIdent(c)))
      .join(", ");
    const pk = pkByTable.get(table) ?? [];
    const orderBy = pk.length ? ` ORDER BY ${pk.map(quoteIdent).join(", ")}` : "";

    // No deletedAt filter, on purpose - see rule 1 in
    // backup-coverage.ts. A live row can reference a soft-deleted one,
    // and a backup that drops the referenced row cannot be restored.
    const rows = await exec.query<Record<string, unknown>>(
      `SELECT ${selectList} FROM ${quoteIdent(table)}${orderBy}`
    );

    tables[table] = {
      columns,
      redacted,
      rowCount: rows.length,
      rows: rows.map((r) => columns.map((c) => (c in redacted ? redacted[c] : normalizeValue(r[c])))),
    };
  }

  const skipped: Record<string, { reason: string; recovery: string }> = {};
  for (const c of Object.values(BACKUP_COVERAGE)) {
    if (c.decision === "SKIP") skipped[c.table] = { reason: c.reason, recovery: c.recovery };
  }

  return {
    format: 2,
    generatedAt: now.toISOString(),
    schemaMigration,
    tables,
    skipped,
    problems,
  };
}

/// The Prisma-backed executor used by the app. Kept here rather than in
/// backup-export.ts so that the only file importing Prisma for this
/// feature is the one the app actually runs.
export function prismaExecutor(client: {
  $queryRawUnsafe: (sql: string) => Promise<unknown>;
}): SqlExecutor {
  return {
    async query<T>(sql: string): Promise<T[]> {
      return (await client.$queryRawUnsafe(sql)) as T[];
    },
  };
}

export function totalRows(dump: Dump): number {
  return Object.values(dump.tables).reduce((sum, t) => sum + t.rowCount, 0);
}

/// Largest tables first, for the warning that fires when the dump
/// outgrows this design.
export function largestTables(dump: Dump, take = 5): Array<{ table: string; rows: number }> {
  return Object.entries(dump.tables)
    .map(([table, t]) => ({ table, rows: t.rowCount }))
    .sort((a, b) => b.rows - a.rows)
    .slice(0, take);
}
