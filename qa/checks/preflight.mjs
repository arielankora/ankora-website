// Preflight - can this environment even run these checks?
//
// This exists because of a real incident during the suite's own bring-up:
// `tsc` went red not because a type broke, but because `prisma generate`
// could not reach binaries.prisma.sh through an egress policy, so the
// generated client types did not exist. A runner that reports that as a
// product failure is worse than useless - it teaches its owner that red
// means "probably the environment" and the next real regression gets
// waved through.
//
// So: every capability the checks depend on is verified up front, and
// anything unavailable turns the dependent checks into an explicit SKIP
// with a stated reason, never a FAIL.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/discover.mjs";
import { finding } from "../lib/report.mjs";
import { reachable } from "../lib/sh.mjs";
import { egressBlocked } from "./production.mjs";

/** Filled by `preflight()`, read by the runner's `skipIf` hooks. */
export const capabilities = {
  prismaClient: false,
  database: false,
  browser: false,
  production: false,
};

function prismaClientGenerated() {
  // The stub shipped in node_modules has no models in it. Presence of the
  // directory proves nothing; presence of a model from our own schema does.
  const dts = path.join(ROOT, "node_modules", ".prisma", "client", "index.d.ts");
  if (!fs.existsSync(dts)) return false;
  return fs.readFileSync(dts, "utf8").includes("TimeEntry");
}

async function databaseUp() {
  const url = process.env.QA_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const { host, port } = new URL(url.replace(/^postgres(ql)?:/, "http:"));
    const net = await import("node:net");
    return await new Promise((resolve) => {
      const s = net.createConnection({ host, port: Number(port || 5432) }, () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
      s.setTimeout(3000, () => {
        s.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

function browserAvailable() {
  // Playwright's bundled Chromium, or the one this sandbox preinstalls.
  return (
    fs.existsSync("/opt/pw-browsers/chromium") ||
    fs.existsSync(path.join(ROOT, "node_modules", "@playwright", "test"))
  );
}

export async function preflight() {
  capabilities.prismaClient = prismaClientGenerated();
  capabilities.database = await databaseUp();
  capabilities.browser = browserAvailable();
  capabilities.production =
    !(await egressBlocked()) && (await reachable(process.env.QA_PROD_URL ?? "https://ankora.co.il"));

  const out = [];
  const state = Object.entries(capabilities)
    .map(([k, v]) => `${v ? "✓" : "✗"} ${k}`)
    .join("   ");
  out.push(finding("info", "environment", state));

  if (!capabilities.prismaClient) {
    out.push(
      finding(
        "minor",
        "Prisma client not generated — type check and unit tests will be skipped",
        "Run `npx prisma generate`. If it fails with 403 on binaries.prisma.sh, this environment's egress policy blocks Prisma's binary host; run the suite in CI instead.",
      ),
    );
  }
  if (!capabilities.database) {
    out.push(finding("minor", "No reachable database — integration tests will be skipped", "Start one with `npm run db:dev`."));
  }
  if (!capabilities.production) {
    out.push(
      finding("minor", "Production not reachable — live probe will be skipped", "Expected locally; the probe is meant to run in CI."),
    );
  }
  return out;
}

/** Reasons, phrased for a human reading the report a week later. */
export const needs = {
  prisma: async () => (capabilities.prismaClient ? null : "Prisma client not generated in this environment"),
  database: async () => (capabilities.database ? null : "no database reachable"),
  browser: async () => (capabilities.browser ? null : "no browser available"),
  production: async () => (capabilities.production ? null : "production not reachable from here"),
};
