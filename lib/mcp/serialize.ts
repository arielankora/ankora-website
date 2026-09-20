// Phase 13 (MCP server, docs/adr/0005): shaping domain rows for a model.
//
// Pure and structurally typed - it takes the fields it needs rather than
// importing Prisma's generated types - so tests/unit/mcp/serialize.test.ts
// can run it with plain objects.
//
// Three rules, all learned from what models get wrong when reading tool
// output:
//
//   1. Never hand back a whole Prisma row. `select`-ing implicitly by
//      spreading means every future column (including something like
//      `passwordHash` on a joined user) silently joins the payload. These
//      functions name every field they emit.
//   2. Emit machine values, not display strings. lib/time-entry-format.ts
//      renders "2:45" and "טיימר" for a human reading a table; a model
//      reasoning about totals needs `minutes: 165`. The Hebrew labels stay
//      where they belong, on the screen.
//   3. Emit ISO 8601 with offset for instants, and say which timezone the
//      user is in separately. A bare "14:03" is the single most common
//      source of an hour-off answer once someone travels.

export type TimeEntryLike = {
  id: string;
  startAt: Date;
  endAt: Date | null;
  actualSeconds: number | null;
  billableSeconds: number | null;
  note: string | null;
  source: string;
  isManual: boolean;
  isEdited: boolean;
  client?: { name: string } | null;
  category?: { name: string } | null;
  task?: { title: string } | null;
};

export type SerializedTimeEntry = {
  id: string;
  client: string | null;
  category: string | null;
  task: string | null;
  startAt: string;
  endAt: string | null;
  running: boolean;
  actualMinutes: number | null;
  billableMinutes: number | null;
  note: string | null;
  source: string;
  edited: boolean;
};

/// Seconds to whole minutes. Ankora bills in minutes everywhere
/// (lib/app-domain/billing.ts works in minutes), so rounding here keeps
/// a model's arithmetic consistent with what the reports screen shows
/// rather than a few seconds off it.
export function toMinutes(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  return Math.round(seconds / 60);
}

export function serializeTimeEntry(entry: TimeEntryLike): SerializedTimeEntry {
  return {
    id: entry.id,
    client: entry.client?.name ?? null,
    category: entry.category?.name ?? null,
    task: entry.task?.title ?? null,
    startAt: entry.startAt.toISOString(),
    endAt: entry.endAt ? entry.endAt.toISOString() : null,
    running: entry.endAt === null,
    actualMinutes: toMinutes(entry.actualSeconds),
    billableMinutes: toMinutes(entry.billableSeconds),
    note: entry.note,
    source: entry.source,
    edited: entry.isEdited,
  };
}

/// How long a running timer has been going. Taken from `now` rather than
/// read off the row because `actualSeconds` is only written when the timer
/// stops (see stopTimer in lib/app-domain/time-entries.ts) - a running
/// entry has it as null, and a model asked "how long have I been on this"
/// would otherwise get nothing.
export function elapsedMinutes(startAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - startAt.getTime()) / 60000));
}

export type ClientLike = { id: string; name: string; status: string };

/// Clients are emitted WITH their id even though no tool requires one as
/// input (see lib/mcp/resolve.ts for why). The id is here so that a model
/// echoing a result back to the user, or correlating two calls, has a
/// stable handle - not so that it can be typed into a write tool.
export function serializeClient(client: ClientLike): { id: string; name: string; status: string } {
  return { id: client.id, name: client.name, status: client.status };
}
