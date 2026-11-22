import type { AgentBlock, AgentParam } from "./model";

// Agents, phase 1: what changed between two versions, block by block, for
// the versions screen. Lines are compared, not characters: a manager reads
// a rule, not a keystroke.

export type DiffLine = { type: "same" | "add" | "del"; text: string };
export type BlockDiff = { key: string; title: string; kind: AgentBlock["kind"]; clientId?: string | null; status: "changed" | "added" | "removed"; lines: DiffLine[] };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Longest common subsequence, small inputs (a block is at most a few hundred lines).
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "del", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

const whole = (b: AgentBlock) => [b.title, b.body, b.why ?? ""].join("\n");

export function diffBlocks(before: AgentBlock[], after: AgentBlock[]): { changes: BlockDiff[]; unchanged: number } {
  const old = new Map(before.map((b) => [b.key, b]));
  const now = new Map(after.map((b) => [b.key, b]));
  const changes: BlockDiff[] = [];
  let unchanged = 0;
  for (const b of after) {
    const o = old.get(b.key);
    if (!o) changes.push({ key: b.key, title: b.title, kind: b.kind, clientId: b.clientId, status: "added", lines: b.body.split("\n").map((text) => ({ type: "add", text })) });
    else if (whole(o) !== whole(b) || o.kind !== b.kind || (o.clientId ?? null) !== (b.clientId ?? null) || !!o.safety !== !!b.safety) {
      changes.push({ key: b.key, title: b.title, kind: b.kind, clientId: b.clientId, status: "changed", lines: diffLines(whole(o), whole(b)) });
    } else unchanged++;
  }
  for (const o of before) if (!now.has(o.key)) changes.push({ key: o.key, title: o.title, kind: o.kind, clientId: o.clientId, status: "removed", lines: o.body.split("\n").map((text) => ({ type: "del", text })) });
  return { changes, unchanged };
}

export function diffParams(before: AgentParam[], after: AgentParam[]): { added: string[]; removed: string[]; changed: string[] } {
  const old = new Map(before.map((p) => [p.key, JSON.stringify(p)]));
  const now = new Map(after.map((p) => [p.key, JSON.stringify(p)]));
  return {
    added: after.filter((p) => !old.has(p.key)).map((p) => p.label),
    removed: before.filter((p) => !now.has(p.key)).map((p) => p.label),
    changed: after.filter((p) => old.has(p.key) && old.get(p.key) !== now.get(p.key)).map((p) => p.label),
  };
}
