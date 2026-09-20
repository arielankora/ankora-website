// Level 1 - static analysis. Cheap, deterministic, catches the class of
// breakage that never reaches a browser because the build dies first.

import { sh, tail } from "../lib/sh.mjs";
import { finding } from "../lib/report.mjs";

export async function types() {
  const r = await sh("npx", ["tsc", "--noEmit"], { timeoutMs: 6 * 60_000 });
  if (r.code === 0) return [];
  const errors = r.all.split("\n").filter((l) => /error TS\d+/.test(l));
  return [
    finding("blocker", `${errors.length} TypeScript error(s)`, errors.slice(0, 15).join("\n")),
  ];
}

export async function lint() {
  const r = await sh("npx", ["next", "lint", "--max-warnings", "9999"], { timeoutMs: 6 * 60_000 });
  const warnings = (r.all.match(/Warning:/g) ?? []).length;
  const errors = (r.all.match(/Error:/g) ?? []).length;
  const out = [];
  // The repo carries two baseline warnings (documented in the redesign
  // notes). Anything above that is new and worth a look, but lint noise
  // is never a reason to block a deploy.
  if (errors) out.push(finding("major", `${errors} lint error(s)`, tail(r.all, 20)));
  if (warnings > 2) out.push(finding("minor", `${warnings} lint warnings (baseline is 2)`, tail(r.all, 20)));
  return out;
}
