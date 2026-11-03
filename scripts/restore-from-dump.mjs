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
import { pathToFileURL } from "node:url";
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

/** Tables a migration writes a default row into. In a freshly migrated
 * target those rows give way to the dump's. */
const SEEDED_BY_MIGRATION = new Set(["app_settings"]);

/**
 * Restore order: Kahn's algorithm over the target's foreign keys,
 * restricted to the dumped tables.
 *
 * A cycle of foreign keys (3.11.2026: clients.subprocessorNoticeDocumentId
 * -> client_documents -> tasks -> clients) has no order. When one shows
 * up, a foreign key on that cycle whose column may be null is set aside:
 * its rows go in with that column empty, and the column is filled in
 * after every table is in, inside the same transaction. A cycle made
 * only of required columns cannot be restored row by row, and still
 * stops the restore with the tables named.
 *
 * `edges` are { child, parent, column, nullable }. Returns the order and
 * the set-aside columns as { table, column }.
 */
export function restoreOrder(tables, edges) {
  const inDump = new Set(tables);
  let active = edges.filter((e) => e.child !== e.parent && inDump.has(e.child) && inDump.has(e.parent));
  const deferred = [];
  for (;;) {
    const remaining = new Set(tables);
    const deps = new Map(tables.map((t) => [t, new Set()]));
    for (const e of active) deps.get(e.child).add(e.parent);
    const ordered = [];
    while (remaining.size) {
      const ready = [...remaining].filter((t) => [...deps.get(t)].every((d) => !remaining.has(d))).sort();
      if (!ready.length) break;
      for (const t of ready) {
        ordered.push(t);
        remaining.delete(t);
      }
    }
    if (!remaining.size) return { order: ordered, deferred };

    // Stuck: the foreign keys that close a cycle are those whose parent
    // depends, through the others, on their child.
    const dependsOn = (from, to) => {
      const seen = new Set();
      const stack = [from];
      while (stack.length) {
        const t = stack.pop();
        if (t === to) return true;
        if (seen.has(t)) continue;
        seen.add(t);
        for (const d of deps.get(t)) if (remaining.has(d)) stack.push(d);
      }
      return false;
    };
    const breakable = active.filter(
      (e) => e.nullable && remaining.has(e.child) && remaining.has(e.parent) && dependsOn(e.parent, e.child)
    );
    if (!breakable.length) {
      throw new Error(`Foreign-key cycle among: ${[...remaining].join(", ")}. Restore order cannot be derived.`);
    }
    // Set aside as few as possible: the one key whose removal frees the
    // most tables, then look again. One key usually closes every cycle.
    let best = breakable[0];
    let bestLeft = Infinity;
    for (const e of breakable) {
      const left = stuckAfter(tables, active.filter((x) => x !== e));
      if (left < bestLeft) {
        best = e;
        bestLeft = left;
      }
    }
    deferred.push({ table: best.child, column: best.column });
    active = active.filter((e) => e !== best);
  }
}

/** How many tables Kahn's algorithm cannot place under these edges. */
function stuckAfter(tables, edges) {
  const remaining = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const e of edges) deps.get(e.child).add(e.parent);
  for (;;) {
    const ready = [...remaining].filter((t) => [...deps.get(t)].every((d) => !remaining.has(d)));
    if (!ready.length) return remaining.size;
    for (const t of ready) remaining.delete(t);
  }
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
      // By name, as the dump records it (lib/app-domain/backup-dump.ts).
      const r = await client.query(
        `SELECT migration_name FROM _prisma_migrations
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         ORDER BY migration_name DESC LIMIT 1`
      );
      targetMigration = r.rows[0]?.migration_name ?? null;
    } catch {
      targetMigration = null;
    }
    if (dump.schemaMigration !== targetMigration) {
      const msg = `Dump was taken at migration "${dump.schemaMigration}" but this database is at "${targetMigration}".`;
      if (!args.allowSchemaDrift) {
        throw new Error(
          `${msg} Run \`prisma migrate deploy\` to the dump's migration, or pass --allow-schema-drift if you know why they differ. ` +
            `A dump taken before 4.11.2026 named the migration that ran last, not the newest by name: if the dump's migration is in this database's _prisma_migrations, the schemas match and --allow-schema-drift is safe.`
        );
      }
      console.warn(`WARNING: ${msg} Continuing because --allow-schema-drift was given.`);
    }

    // --- catalog ----------------------------------------------------------
    const dumpTables = Object.keys(dump.tables);
    // One row per foreign-key column, with whether it may be null: a
    // nullable key on a cycle is filled in last (restoreOrder).
    const fk = await client.query(
      `SELECT c.relname AS child, f.relname AS parent, a.attname AS column, NOT a.attnotnull AS nullable
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_class f ON f.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace`
    );
    const { order, deferred } = restoreOrder(dumpTables, fk.rows);

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
      for (const d of deferred) console.log(`Filled in after all tables (foreign-key cycle): ${d.table}.${d.column}`);
      return;
    }

    // --- load -------------------------------------------------------------
    await client.query("BEGIN");

    if (args.truncate) {
      // One statement, so the cascade and the FK checks resolve together.
      await client.query(`TRUNCATE TABLE ${order.map((t) => `"${t}"`).join(", ")} CASCADE`);
    } else {
      // A freshly migrated database is not quite empty: a migration may
      // write a default row (3.11.2026: app_settings, the auto-apply
      // switch). The dump has the real value, so those rows give way to
      // it. Rows anywhere else mean this is not the empty target the
      // restore expects.
      const occupied = [];
      for (const table of order) {
        const r = await client.query(`SELECT EXISTS (SELECT 1 FROM "${table}") AS any`);
        if (r.rows[0].any) occupied.push(table);
      }
      const unexpected = occupied.filter((t) => !SEEDED_BY_MIGRATION.has(t));
      if (unexpected.length) {
        throw new Error(`The target already has rows in: ${unexpected.join(", ")}. Restore into an empty, migrated database, or pass --truncate to replace them.`);
      }
      for (const t of occupied) await client.query(`DELETE FROM "${t}"`);
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

      // A set-aside foreign key goes in empty now and is filled in below.
      const later = new Set(deferred.filter((d) => d.table === table).map((d) => t.columns.indexOf(d.column)).filter((i) => i >= 0));
      if (later.size) rows = rows.map((row) => row.map((v, ci) => (later.has(ci) ? null : v)));

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

    // The foreign keys set aside for a cycle, now that every row exists.
    for (const d of deferred) {
      const t = dump.tables[d.table];
      const idIdx = t ? t.columns.indexOf("id") : -1;
      const colIdx = t ? t.columns.indexOf(d.column) : -1;
      if (idIdx < 0 || colIdx < 0) continue;
      const idType = udtByColumn.get(`${d.table}.id`);
      const colType = udtByColumn.get(`${d.table}.${d.column}`);
      const pairs = t.rows.filter((row) => row[colIdx] !== null && row[colIdx] !== undefined);
      const CHUNK = 200;
      for (let i = 0; i < pairs.length; i += CHUNK) {
        const params = [];
        const valueSql = pairs
          .slice(i, i + CHUNK)
          .map((row) => {
            params.push(decode(row[idIdx], idType), decode(row[colIdx], colType));
            return `($${params.length - 1}::${idType}, $${params.length}::${colType})`;
          })
          .join(", ");
        await client.query(
          `UPDATE "${d.table}" AS t SET "${d.column}" = v.val FROM (VALUES ${valueSql}) AS v(id, val) WHERE t."id" = v.id`,
          params
        );
      }
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

// Run only as a command, so the unit suite can import restoreOrder.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Restore failed: ${err.message}`);
    process.exit(1);
  });
}
