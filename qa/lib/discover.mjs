// Capability discovery.
//
// This file answers one question: "what can this product actually do,
// right now, according to its own source code?"
//
// It is deliberately derived from the filesystem and never from a
// hand-maintained list. A hand-maintained inventory is wrong the day
// after someone ships a feature; a derived one cannot be. That is the
// whole mechanism behind the QA agent staying current - `scan.mjs`
// diffs what this file finds against `qa/manifest.json`, and anything
// new shows up as drift the same run it lands.

import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Recursive file walk with no dependency on a glob package. */
export function walk(dir, filter = () => true, acc = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, filter, acc);
    else if (filter(rel)) acc.push(rel);
  }
  return acc;
}

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
};

/**
 * Turn an App Router file path into the URL it serves.
 * Strips route groups `(product)`, keeps dynamic segments `[id]`.
 */
function routeFromFile(file) {
  const url = file
    .replace(/^app/, "")
    .replace(/\/(page|route)\.tsx?$/, "")
    .split("/")
    .filter((s) => !/^\(.*\)$/.test(s))
    .join("/");
  return url === "" ? "/" : url;
}

/** Marketing site: every localised public page. */
function marketingPages() {
  return walk("app/[locale]", (f) => f.endsWith("/page.tsx")).map((file) => {
    const route = routeFromFile(file);
    const isAdmin = route.startsWith("/[locale]/admin");
    return {
      id: `page:${route}`,
      kind: "page",
      area: isAdmin ? "blog-admin" : "marketing",
      route,
      // Marketing pages render in both locales; the e2e sweep expands this.
      locales: isAdmin ? ["he"] : ["he", "en"],
      sources: [file],
    };
  });
}

/** Product: every screen inside /app. */
function appScreens() {
  return walk("app/(product)", (f) => f.endsWith("/page.tsx")).map((file) => ({
    id: `screen:${routeFromFile(file)}`,
    kind: "screen",
    area: "app",
    route: routeFromFile(file),
    authenticated: file.includes("(authenticated)"),
    sources: [file],
  }));
}

/** Every HTTP endpoint. */
function apiRoutes() {
  return walk("app/api", (f) => f.endsWith("/route.ts")).map((file) => {
    const route = routeFromFile(file);
    const body = read(file);
    const methods = [...body.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map(
      (m) => m[1],
    );
    return {
      id: `api:${route}`,
      kind: "api",
      area: route.startsWith("/api/mcp")
        ? "mcp"
        : route.startsWith("/api/cron")
          ? "cron"
          : route.startsWith("/api/admin")
            ? "blog-admin"
            : "api",
      route,
      methods: methods.length ? methods : ["GET"],
      sources: [file],
    };
  });
}

/** Business logic modules - where the rules that matter actually live. */
function domainModules() {
  return walk("lib/app-domain", (f) => f.endsWith(".ts")).map((file) => ({
    id: `domain:${path.basename(file, ".ts")}`,
    kind: "domain",
    area: "app",
    sources: [file],
  }));
}

/** MCP tools exposed to external AI clients. */
function mcpTools() {
  const body = read("lib/mcp/tools.ts");
  const names = [...body.matchAll(/name:\s*"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]);
  // Fallback: tool names also appear as bare quoted identifiers in the
  // registry object. Union both so a refactor of the shape cannot make
  // tools silently vanish from the inventory.
  const bare = [...body.matchAll(/"((?:list|get|start|stop|create|update|delete)_[a-z_]+)"/g)].map((m) => m[1]);
  return [...new Set([...names, ...bare])].sort().map((name) => ({
    id: `mcp:${name}`,
    kind: "mcp-tool",
    area: "mcp",
    sources: ["lib/mcp/tools.ts"],
  }));
}

/** Scheduled jobs, read from the deploy config rather than assumed. */
function crons() {
  let cfg = {};
  try {
    cfg = JSON.parse(read("vercel.json") || "{}");
  } catch {
    /* reported as a finding by the config check, not here */
  }
  return (cfg.crons ?? []).map((c) => ({
    id: `cron:${c.path}`,
    kind: "cron",
    area: "cron",
    route: c.path,
    schedule: c.schedule,
    sources: [`app${c.path}/route.ts`],
  }));
}

/** Server Actions - the other write path into the product, besides /api. */
function serverActions() {
  const files = walk("app", (f) => /\.tsx?$/.test(f)).filter((f) => /^\s*["']use server["']/m.test(read(f)));
  return files.map((file) => ({
    id: `action:${file.replace(/^app\//, "").replace(/\.tsx?$/, "")}`,
    kind: "server-action",
    area: "app",
    sources: [file],
  }));
}

/** Everything the product is, in one array. */
export function discover() {
  return [
    ...marketingPages(),
    ...appScreens(),
    ...apiRoutes(),
    ...domainModules(),
    ...serverActions(),
    ...mcpTools(),
    ...crons(),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Coverage is computed, not declared.
 *
 * Declared coverage ("this capability is covered by test X") is a second
 * inventory to maintain, and it rots exactly like the first one. Instead
 * we ask the test files themselves: does anything under tests/ import
 * this module, does any e2e spec drive this route?
 *
 * The trade-off is honest and worth stating: this proves a test *touches*
 * a capability, not that it tests it well. It is a floor, not a ceiling -
 * it catches "nobody has looked at this at all", which is the failure
 * mode that actually bites after a feature ships.
 */
export function computeCoverage(caps) {
  const suites = {
    unit: walk("tests/unit", (f) => f.endsWith(".test.ts")),
    integration: walk("tests/integration", (f) => f.endsWith(".test.ts")),
    e2e: walk("qa/e2e", (f) => f.endsWith(".spec.ts")),
  };
  const bodies = Object.fromEntries(
    Object.entries(suites).map(([suite, files]) => [suite, files.map((f) => ({ file: f, text: read(f) }))]),
  );

  return caps.map((cap) => {
    const needles = needlesFor(cap);
    const coverage = {};
    for (const [suite, files] of Object.entries(bodies)) {
      const hits = files.filter((f) => needles.some((n) => f.text.includes(n))).map((f) => f.file);
      if (hits.length) coverage[suite] = hits;
    }
    return { ...cap, coverage };
  });
}

/** The strings whose presence in a test file counts as touching a capability. */
function needlesFor(cap) {
  switch (cap.kind) {
    case "domain":
      return [`app-domain/${cap.id.slice("domain:".length)}`];
    case "mcp-tool":
      return [`"${cap.id.slice("mcp:".length)}"`, `'${cap.id.slice("mcp:".length)}'`];
    case "page":
    case "screen":
      // Route strings are how an e2e spec names its target.
      return [cap.route.replace("/[locale]", "/he"), cap.route.replace("/[locale]", "/en"), cap.route];
    case "api":
    case "cron":
      // Same inheritance argument as Server Actions below: a route handler
      // is a thin HTTP shell over a lib module. Without this, well-tested
      // logic reads as uncovered merely because the test imports the lib
      // instead of naming the URL - a false alarm that would train everyone
      // to ignore this report, which is the one thing it must never do.
      return [cap.route, ...localLibImports(cap.sources[0])];
    case "server-action": {
      // A Server Action is almost always a thin authorisation-and-revalidate
      // wrapper around a domain module. Crediting it only when a test names
      // the action file itself would flag the entire /app as uncovered while
      // the logic underneath is in fact well tested. So an action inherits
      // the coverage of the domain modules it imports, and additionally
      // counts any test that names the file directly.
      return [cap.sources[0].replace(/\.tsx?$/, ""), ...localLibImports(cap.sources[0])];
    }
    default:
      return [cap.id];
  }
}

/** The `lib/...` modules a file imports - the logic it is a shell over. */
function localLibImports(file) {
  const body = read(file);
  const hits = [...body.matchAll(/from\s+["']@?\/?(lib\/[a-zA-Z0-9\-_/]+)["']/g)].map((m) => m[1]);
  return [...new Set(hits)];
}
