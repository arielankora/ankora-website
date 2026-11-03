// Level 1 - a new vendor in the code (P8, 3.11.2026).
//
// P8 (הוספת תת-מעבד חדש) has to start before a vendor reaches client data.
// The task-text detection in lib/vendor-detection.ts asks when a task says
// it connects one; this check looks where a connection actually happens:
// a new package in package.json, or a new process.env name in the code.
// Either one, missing from qa/vendor-registry.json, is a finding on the
// pull request that adds it.
//
// Never blocking. Most new packages are libraries, not vendors, and the
// answer is one line in the registry (null for a library or our own
// setting, the vendor's name otherwise). The point is that the question is
// asked at the moment the code changes, by the build, and not left to
// whoever remembers.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { finding } from "../lib/report.mjs";

const ROOTS = ["app", "lib", "components", "scripts", "prisma"];
const ROOT_FILES = ["middleware.ts", "auth.ts", "auth.config.ts"];
const ENV_RE = /process\.env\.([A-Z][A-Z0-9_]*)/g;

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The rule, pure: what the code uses that the registry does not know.
 *
 * @param {{dependencies?: Record<string, string>, devDependencies?: Record<string, string>}} pkg
 * @param {string[]} sources - the text of every scanned file
 * @param {{dependencies: Record<string, string|null>, env: Record<string, string|null>}} registry
 * @returns {{dependencies: string[], env: string[]}}
 */
export function unregistered(pkg, sources, registry) {
  const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  const env = new Set();
  for (const src of sources) for (const m of src.matchAll(ENV_RE)) env.add(m[1]);
  return {
    dependencies: deps.filter((d) => !(d in registry.dependencies)).sort(),
    env: [...env].filter((e) => !(e in registry.env)).sort(),
  };
}

export async function newVendors() {
  const [pkg, registry] = await Promise.all([
    readFile("package.json", "utf-8").then(JSON.parse),
    readFile("qa/vendor-registry.json", "utf-8").then(JSON.parse),
  ]);
  const files = [...ROOT_FILES];
  for (const root of ROOTS) files.push(...(await walk(root)));
  const sources = [];
  for (const f of files) {
    try {
      sources.push(await readFile(f, "utf-8"));
    } catch {
      // A root file that does not exist is not a finding about this rule.
    }
  }

  const missing = unregistered(pkg, sources, registry);
  if (missing.dependencies.length === 0 && missing.env.length === 0) return [];
  return [
    finding(
      "major",
      `New in the code and not in qa/vendor-registry.json: ${missing.dependencies.length} package(s), ${missing.env.length} environment variable(s)`,
      [
        "A new package or environment variable can be a new vendor reaching client data.",
        "If it is one: open a P8 run (הוספת תת-מעבד חדש) before it goes live, and write the",
        "vendor's name next to it in qa/vendor-registry.json.",
        "If it is a library or our own setting: add it there with null.",
        "",
        ...missing.dependencies.map((d) => `package: ${d}`),
        ...missing.env.map((e) => `env: ${e}`),
      ].join("\n"),
    ),
  ];
}
