/// A tiny catalog-driven fixture generator, used only by
/// backup-restore-roundtrip.test.ts.
///
/// It exists because the round trip has to cover every table the backup
/// claims to cover, and a hand-written fixture covers the tables its
/// author remembered. This one reads the database's own catalog, so a
/// table added next year is populated, dumped and compared without
/// anybody editing this file - which is the same property the backup
/// itself is supposed to have, and the reason the test is worth having
/// at all.
///
/// Plain `pg`, no Prisma: the round trip must be runnable in an
/// environment where the Prisma client was never generated.

import type { Client } from "pg";

export interface ColumnInfo {
  name: string;
  udt: string;
  nullable: boolean;
  isIdentity: boolean;
}

export async function tableColumns(db: Client, table: string): Promise<ColumnInfo[]> {
  const r = await db.query(
    `SELECT column_name, udt_name, is_nullable, is_identity
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((c: Record<string, string>) => ({
    name: c.column_name,
    udt: c.udt_name,
    nullable: c.is_nullable === "YES",
    isIdentity: c.is_identity === "YES",
  }));
}

/// Note `parentColumn`: not every foreign key points at an `id`.
/// external_mappings.provider references integration_connections.provider,
/// and a fixture that assumes otherwise fails on that one table only -
/// which is exactly the kind of thing a generated fixture is for.
export async function foreignKeys(
  db: Client
): Promise<Array<{ child: string; column: string; parent: string; parentColumn: string }>> {
  const r = await db.query(
    `SELECT c.relname AS child, a.attname AS column, f.relname AS parent, fa.attname AS "parentColumn"
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_class f ON f.oid = con.confrelid
     JOIN LATERAL unnest(con.conkey) WITH ORDINALITY k(attnum, ord) ON true
     JOIN LATERAL unnest(con.confkey) WITH ORDINALITY fk(attnum, ord) ON fk.ord = k.ord
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
     JOIN pg_attribute fa ON fa.attrelid = f.oid AND fa.attnum = fk.attnum
     WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace`
  );
  return r.rows;
}

export async function enumLabels(db: Client): Promise<Map<string, string[]>> {
  const r = await db.query(
    `SELECT t.typname, e.enumlabel
     FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     ORDER BY t.typname, e.enumsortorder`
  );
  const out = new Map<string, string[]>();
  for (const row of r.rows) {
    const list = out.get(row.typname) ?? [];
    list.push(row.enumlabel);
    out.set(row.typname, list);
  }
  return out;
}

export function topoSort(tables: string[], edges: Array<[string, string]>): string[] {
  const remaining = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const [child, parent] of edges) {
    if (child === parent) continue;
    if (remaining.has(child) && remaining.has(parent)) deps.get(child)!.add(parent);
  }
  const ordered: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((t) => [...deps.get(t)!].every((d) => !remaining.has(d))).sort();
    if (!ready.length) throw new Error(`Cycle among ${[...remaining].join(", ")}`);
    for (const t of ready) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

/// Every column gets a value, including nullable ones. Leaving nullables
/// null would let a whole class of round-trip bug through: a column that
/// is always null compares equal no matter what the dump did to it.
/// Timestamps in particular are set rather than left null, which also
/// keeps the fixture clear of this schema's partial unique indexes (the
/// "one running timer per user" index is `WHERE endAt IS NULL`).
export function fixtureValue(
  table: string,
  col: ColumnInfo,
  i: number,
  enums: Map<string, string[]>,
  fkTarget: { parent: string; parentColumn: string } | undefined,
  valuesByTable: Map<string, Map<string, unknown[]>>
): unknown {
  if (col.name === "id") return `${table}-${i}`;

  if (fkTarget) {
    const parentValues = valuesByTable.get(fkTarget.parent)?.get(fkTarget.parentColumn) ?? [];
    if (!parentValues.length) return null;
    return parentValues[i % parentValues.length];
  }

  const labels = enums.get(col.udt);
  if (labels?.length) return labels[i % labels.length];

  switch (col.udt) {
    case "bool":
      return i % 2 === 0;
    case "int2":
    case "int4":
    case "int8":
      return i + 1;
    case "timestamp":
    case "timestamptz":
      return new Date(Date.UTC(2026, 0, 1 + i, 9, 30, 0)).toISOString();
    case "date":
      return `2026-01-0${(i % 9) + 1}`;
    case "_text":
      return [`${col.name}-a${i}`, `${col.name}-b${i}`];
    case "_int4":
      return [i, i + 10];
    // Half objects and half arrays on purpose: an array inside a jsonb
    // column is the case that breaks a restore which hands node-postgres
    // a JS array and lets it render a Postgres array literal.
    case "json":
    case "jsonb":
      return i % 2 === 0 ? { col: col.name, i } : [col.name, i];
    default:
      return `${table}.${col.name}#${i}`;
  }
}
