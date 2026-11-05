import { flowOrder, nextOf, type FlowNode, type ProcessFlow } from "@/lib/process-flow";

// Where each node sits on the desktop canvas when nobody placed it yet:
// one row per step down from the start, nodes of a row spread across.
// Pure, so a test can hold it.

export const NODE_W = 240;
export const ROW_H = 150;
export const COL_W = 290;

export function autoPositions(flow: ProcessFlow): Map<string, { x: number; y: number }> {
  const order = flowOrder(flow) ?? flow.nodes;
  const row = new Map<string, number>();
  if (flow.start) row.set(flow.start, 0);
  for (const n of order) {
    const r = row.get(n.id) ?? 0;
    for (const t of nextOf(n)) if (t) row.set(t, Math.max(row.get(t) ?? 0, r + 1));
  }
  const rows = new Map<number, FlowNode[]>();
  for (const n of order) {
    const r = row.get(n.id) ?? 0;
    rows.set(r, [...(rows.get(r) ?? []), n]);
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const [r, list] of rows) {
    list.forEach((n, i) => {
      out.set(n.id, { x: (i - (list.length - 1) / 2) * COL_W, y: r * ROW_H });
    });
  }
  return out;
}

/// A fresh id for a node or a branch, inside the shape readFlow accepts.
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!used.has(id)) return id;
  }
}
