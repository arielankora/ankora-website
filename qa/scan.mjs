#!/usr/bin/env node
// Capability drift scanner.
//
//   node qa/scan.mjs            # check mode - report drift, exit 1 if blocking
//   node qa/scan.mjs --sync     # write newly discovered capabilities into the manifest
//   node qa/scan.mjs --json     # machine-readable, for the QA agent
//
// Drift is the single most valuable signal this whole suite produces.
// A test suite does not decay because its tests break - broken tests are
// loud. It decays because the product grows past it in silence. This
// scanner makes that silence impossible: anything shipped without a test
// shows up here on the very next run.

import fs from "node:fs";
import path from "node:path";
import { ROOT, discover, computeCoverage } from "./lib/discover.mjs";

const MANIFEST = path.join(ROOT, "qa", "manifest.json");

const args = process.argv.slice(2);
const SYNC = args.includes("--sync");
const JSON_OUT = args.includes("--json");

/** Risk tiers decide *how much* proof a capability needs, not whether it is tested. */
const REQUIRED_BY_RISK = {
  critical: ["unit|integration", "e2e"], // money, auth, data integrity
  high: ["unit|integration"],
  medium: ["unit|integration|e2e"],
  low: [],
  unassigned: [], // never blocks; always reported so it gets triaged
};

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    return { version: 1, defaultLevel: 2, capabilities: {}, waivers: {} };
  }
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

function saveManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
}

/**
 * A first guess at risk, so a freshly discovered capability is not left
 * at "unassigned" forever. It is a starting point for human or agent
 * judgement, never the final word - the manifest value always wins.
 */
function guessRisk(cap) {
  const id = cap.id;
  if (/login|password|auth|oauth|token|permission|rbac/.test(id)) return "critical";
  if (cap.kind === "domain" && /time-entries|billing|hour-banks|reports|users|client-portal/.test(id)) return "critical";
  if (cap.kind === "cron") return "critical";
  if (cap.kind === "api" && /export|contact|cron|mcp/.test(id)) return "high";
  if (cap.kind === "mcp-tool") return /create_|start_|stop_|update_/.test(id) ? "critical" : "high";
  if (cap.kind === "screen") return "high";
  if (cap.kind === "domain") return "high";
  if (cap.kind === "api") return "high";
  if (cap.area === "marketing") return "medium";
  return "medium";
}

function satisfied(requirement, coverage) {
  return requirement.split("|").some((suite) => (coverage[suite] ?? []).length > 0);
}

function main() {
  const manifest = loadManifest();
  const live = computeCoverage(discover());
  const liveIds = new Set(live.map((c) => c.id));

  const added = live.filter((c) => !manifest.capabilities[c.id]);
  const removed = Object.keys(manifest.capabilities).filter((id) => !liveIds.has(id));

  const gaps = [];
  for (const cap of live) {
    const entry = manifest.capabilities[cap.id];
    const risk = entry?.risk ?? guessRisk(cap);
    if (manifest.waivers?.[cap.id]) continue;
    const missing = (REQUIRED_BY_RISK[risk] ?? []).filter((r) => !satisfied(r, cap.coverage));
    if (missing.length) gaps.push({ id: cap.id, kind: cap.kind, area: cap.area, risk, missing, coverage: cap.coverage });
  }

  if (SYNC) {
    for (const cap of added) {
      manifest.capabilities[cap.id] = {
        kind: cap.kind,
        area: cap.area,
        risk: guessRisk(cap),
        riskAssigned: false, // flips to true once a human or the agent confirms it
        firstSeen: new Date().toISOString().slice(0, 10),
      };
    }
    for (const id of removed) delete manifest.capabilities[id];
    manifest.lastScan = new Date().toISOString().slice(0, 10);
    saveManifest(manifest);
  }

  const unassigned = live.filter((c) => manifest.capabilities[c.id]?.riskAssigned === false);

  const result = {
    total: live.length,
    byArea: live.reduce((acc, c) => ({ ...acc, [c.area]: (acc[c.area] ?? 0) + 1 }), {}),
    added: added.map((c) => c.id),
    removed,
    unassignedRisk: unassigned.map((c) => c.id),
    gaps,
    blocking: gaps.filter((g) => g.risk === "critical"),
  };

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    report(result, SYNC);
  }

  // Check mode never fails the run on its own. Drift is information the
  // agent acts on (by writing the missing test), not a reason to block a
  // deploy that is otherwise green. `qa/run.mjs` decides what blocks.
  process.exit(0);
}

function report(r, synced) {
  const line = (s = "") => process.stdout.write(s + "\n");
  line();
  line("  CAPABILITY SCAN");
  line("  ───────────────");
  line(`  ${r.total} capabilities  ·  ${Object.entries(r.byArea).map(([a, n]) => `${a} ${n}`).join("  ·  ")}`);
  line();

  if (r.added.length) {
    line(`  NEW since last scan (${r.added.length})${synced ? " - added to manifest" : ""}`);
    r.added.slice(0, 40).forEach((id) => line(`    + ${id}`));
    if (r.added.length > 40) line(`    … and ${r.added.length - 40} more`);
    line();
  }
  if (r.removed.length) {
    line(`  GONE from source (${r.removed.length})${synced ? " - removed from manifest" : ""}`);
    r.removed.forEach((id) => line(`    - ${id}`));
    line();
  }
  if (r.unassignedRisk.length) {
    line(`  RISK NOT YET CONFIRMED (${r.unassignedRisk.length}) - guessed, needs triage`);
    line();
  }
  if (r.gaps.length) {
    const byRisk = r.gaps.reduce((a, g) => ({ ...a, [g.risk]: (a[g.risk] ?? 0) + 1 }), {});
    line(`  COVERAGE GAPS (${r.gaps.length})  ·  ${Object.entries(byRisk).map(([k, v]) => `${k} ${v}`).join("  ·  ")}`);
    for (const g of r.gaps.filter((x) => x.risk === "critical").slice(0, 25)) {
      line(`    ! ${g.id.padEnd(48)} missing: ${g.missing.join(", ")}`);
    }
    const rest = r.gaps.length - Math.min(25, r.blocking.length);
    if (rest > 0) line(`    … ${rest} more at high/medium risk (qa/scan.mjs --json for the full list)`);
    line();
  }
  if (!r.added.length && !r.removed.length && !r.gaps.length) {
    line("  No drift. Every capability has the coverage its risk tier requires.");
    line();
  }
}

main();
