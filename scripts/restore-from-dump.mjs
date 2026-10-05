#!/usr/bin/env node
/**
 * Restores a nightly dump (ankora-database-dump-<date>.json.gz) into an
 * empty, already-migrated database.
 *
 *   node scripts/restore-from-dump.mjs \
 *     --file ./ankora-database-dump-2026-09-29.json.gz \
 *     --database-url "postgresql://..." \
 *     [--truncate] [--dry-run] [--allow-schema-drift]
 *
 * Deliberately written against `pg` and not against Prisma. On the day
 * this script is needed, the thing that broke may be the environment
 * itself, and `prisma generate` reaches out to the network before it
 * produces a client. A restore should depend on as little as possible:
 * node, this file, and a connection string.
 *
 * What it does, in order:
 *   1. Reads the dump (gzip or plain JSON).
 *   2. Refuses to run if the dump's schema migration is not the target's
 *      migration, unless --allow-schema-drift. A dump and a schema that
 *      disagree is how a restore quietly loses a column.
 *   3. Sorts the dumped tables by the target's own foreign-key graph, so
 *      parents are inserted before children, and sorts rows within a
 *      self-referencing table (tasks.parentId) parent-first.
 *   4. Inserts everything inside ONE transaction. A restore that half
 *      succeeds is worse than one that fails.
 *   5. Prints what it restored, and what the dump deliberately does not
 *      contain, with the recovery path for each.
 *
 * Restore order is read from the live database rather than hardcoded
 * here, so a future table with new foreign keys is ordered correctly by
 * this script without anyone editing it.
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";

function parseArgs(argv) {
  const args = { truncate: false, dryRun: false, allowSchemaDrift: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--database-url") args.databaseUrl = argv[++i];
    else if (a === "--truncate") args.truncate = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--allow-schema-drift") args.allowSchemaDrift = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function readDump(file) {
  const raw = readFileSync(file);
  const text = file.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const dump = JSON.parse(text);
  if (dump.format !== 2) {
    throw new Error(`Unsupported dump format ${dump.format}. This script reads format 2.`);
  }
  return dump;
}

/** Kahn's algorithm over the target's foreign keys, restricted to the dumped tables. */
function topoSort(tables, edges) {
  const remaining = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const [child, parent] of edges) {
    if (child === parent) continue; // self-reference: handled per row, not per table
    if (remaining.has(child) && remaining.has(parent)) deps.get(child).add(parent);
  }
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining].filter((t) => [...deps.get(t)].every((d) => !remaining.has(d))).sort();
    if (!ready.length) {
      throw new Error(`Foreign-key cycle among: ${[...remaining].join(", ")}. Restore order cannot be derived.`);
    }
    for (const t of ready) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

/** Rows of a self-referencing table, parents before children. */
function orderRowsParentFirst(rows, idIdx, parentIdx) {
  const byId = new Map(rows.map((r) => [r[idIdx], r]));
  const placed = new Set();
  const out = [];
  const visit = (row, seen) => {
    const id = row[idIdx];
    if (placed.has(id)) return;
    if (seen.has(id)) return; // cyclic parent chain: leave order as-is, the FK will speak
    seen.add(id);
    const parent = row[parentIdx];
    if (parent != null && byId.has(parent)) visit(byId.get(parent), seen);
    placed.add(id);
    out.push(row);
  };
  for (const row of rows) visit(row, new Set());
  return out;
}

function decode(value, udt) {
  if (value === null || value === undefined) return null;
  if (value && typeof value === "object" && typeof value.__bytes_b64 === "string") {
    return Buffer.from(value.__bytes_b64, "base64");
  }
  // json/jsonb: hand Postgres a JSON string. Left as a JS value,
  // node-postgres would render an array as a Postgres array literal,
  // which is not JSON and fails on the way in.
  if (udt === "json" || udt === "jsonb") return JSON.stringify(value);
  return value;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file) {
    console.log("usage: node scripts/restore-from-dump.mjs --file <dump.json[.gz]> [--database-url <url>] [--truncate] [--dry-run] [--allow-schema-drift]");
    process.exit(args.help ? 0 : 1);
  }

  const databaseUrl = args.databaseUrl || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("No target database. Pass --database-url or set DATABASE_URL_UNPOOLED.");

  const dump = readDump(args.file);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // --- schema agreement -------------------------------------------------
    let targetMigration = null;
    try {
      const r = await client.query(
        `SELECT migration_name FROM _prisma_migrations
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         ORDER BY finished_at DESC LIMIT 1`
      );
      targetMigration = r.rows[0]?.migration_name ?? null;
    } catch {
      targetMigration = null;
    }
    if (dump.schemaMigration !== targetMigration) {
      const msg = `Dump was taken at migration "${dump.schemaMigration}" but this database is at "${targetMigration}".`;
      if (!args.allowSchemaDrift) {
        throw new Error(`${msg} Run \`prisma migrate deploy\` to the dump's migration, or pass --allow-schema-drift if you know why they differ.`);
      }
      console.warn(`WARNING: ${msg} Continuing because --allow-schema-drift was given.`);
    }

    // --- catalog ----------------------------------------------------------
    const dumpTables = Object.keys(dump.tables);
    const fk = await client.query(
      `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
       FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace`
    );
    const edges = fk.rows.map((r) => [r.child.replace(/"/g, ""), r.parent.replace(/"/g, "")]);
    const order = topoSort(dumpTables, edges);

    const selfRef = await client.query(
      `SELECT c.relname AS table_name, a.attname AS column_name
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE con.contype = 'f' AND con.conrelid = con.confrelid
         AND con.connamespace = 'public'::regnamespace`
    );
    const selfRefColumn = new Map(selfRef.rows.map((r) => [r.table_name, r.column_name]));

    const udt = await client.query(
      `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public'`
    );
    const udtByColumn = new Map(udt.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.udt_name]));

    if (args.dryRun) {
      console.log(`Dry run. Dump taken ${dump.generatedAt} at migration ${dump.schemaMigration}.`);
      console.log(`Restore order (${order.length} tables):`);
      for (const t of order) console.log(`  ${t.padEnd(34)} ${dump.tables[t].rowCount} rows`);
      return;
    }

    // --- load -------------------------------------------------------------
    await client.query("BEGIN");

    if (args.truncate) {
      // One statement, so the cascade and the FK checks resolve together.
      await client.query(`TRUNCATE TABLE ${order.map((t) => `"${t}"`).join(", ")} CASCADE`);
    }

    const restored = [];
    for (const table of order) {
      const t = dump.tables[table];
      if (!t.rows.length) {
        restored.push({ table, rows: 0 });
        continue;
      }

      let rows = t.rows;
      const selfCol = selfRefColumn.get(table);
      if (selfCol) {
        const idIdx = t.columns.indexOf("id");
        const parentIdx = t.columns.indexOf(selfCol);
        if (idIdx >= 0 && parentIdx >= 0) rows = orderRowsParentFirst(rows, idIdx, parentIdx);
      }

      const colSql = t.columns.map((c) => `"${c}"`).join(", ");
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const params = [];
        const valueSql = chunk
          .map(
            (row) =>
              `(${row
                .map((v, ci) => {
                  params.push(decode(v, udtByColumn.get(`${table}.${t.columns[ci]}`)));
                  return `$${params.length}`;
                })
                .join(", ")})`
          )
          .join(", ");
        await client.query(`INSERT INTO "${table}" (${colSql}) VALUES ${valueSql}`, params);
      }
      restored.push({ table, rows: rows.length });
    }

    await client.query("COMMIT");

    console.log(`Restored from ${args.file} (taken ${dump.generatedAt}, migration ${dump.schemaMigration}):`);
    for (const r of restored) console.log(`  ${r.table.padEnd(34)} ${r.rows}`);
    const total = restored.reduce((s, r) => s + r.rows, 0);
    console.log(`  ${"TOTAL".padEnd(34)} ${total}`);

    const redactedCols = Object.entries(dump.tables.users?.redacted ?? {});
    if (redactedCols.length) {
      console.log(`\nRedacted in the dump, and therefore a placeholder now: ${redactedCols.map(([c]) => c).join(", ")} on users.`);
      console.log("No restored account can sign in until its owner uses the forgot-password flow.");
    }
    console.log("\nNot in this dump, by decision:");
    for (const [table, info] of Object.entries(dump.skipped ?? {})) {
      console.log(`  ${table.padEnd(30)} ${info.recovery}`);
    }
    if (dump.problems?.length) {
      console.log("\nProblems recorded when this dump was built:");
      for (const p of dump.problems) console.log(`  - ${p}`);
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the transaction may never have opened */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`Restore failed: ${err.message}`);
  process.exit(1);
});
