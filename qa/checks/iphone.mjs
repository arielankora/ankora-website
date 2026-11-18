// Phone layout of the product screens: two checks, one engine underneath.
//
// Why these exist (18.11.2026): a manual iPhone audit found 1,008 critical
// and high occurrences across the product screens, including two screens that
// crashed, while every level-2 and level-3 run had been green. Nothing here
// opened a product screen at phone width: the accessibility audit covers the
// marketing site only, the screen sweep runs at desktop size and skips the
// routes with an id in them, and three narrow specs cover three flows.
//
// "phone" (level 2, every product pull request and every night): the part
// that blocks use, fast enough to gate. Chromium with iPhone viewports (the
// browser this job already has), every product screen including the dynamic
// ones, as the Ankora Admin and as a Client Admin, on the narrowest iPhone
// (320) and on the 15 Pro Max (430). Blocks on: a screen that crashes, a page
// that scrolls sideways, a dialog whose overflow cannot be reached, a field
// under 16px (iOS zooms the page on it), a control pushed off the screen.
//
// "iphone" (level 3, the Sunday hunt, its own shard): the whole audit. WebKit
// (Safari's engine, installed for that shard only), all roles, four iPhones,
// every check including tap targets, safe area and direction. Critical is a
// blocker, high is major, the rest minor.
//
// The page-side checks are qa/iphone/checks.mjs, the driver is
// qa/iphone/audit.mjs; both also run by hand (qa/iphone/README.md). Decided
// findings live in qa/iphone/accepted.json and report as info.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { finding } from "../lib/report.mjs";
import { ROOT } from "../lib/discover.mjs";
import { sh, timedOutFinding } from "../lib/sh.mjs";

const QUICK_DEVICES = ["iPhone SE", "iPhone 15 Pro Max"];
const QUICK_ROLES = ["admin", "clientadmin"];
const SEVERITY_FULL = { critical: "blocker", high: "major", medium: "minor", low: "minor" };
const CHECK_LABEL = {
  "horizontal-overflow": "scrolls sideways",
  "off-screen": "off the screen",
  "cut-off": "cut off",
  "tap-target": "tap target under 44x44",
  "input-font": "field under 16px (iOS zooms in)",
  "safe-area": "no safe-area inset",
  rtl: "direction",
  "modal-height": "dialog taller than the screen",
};

function buildPresent() {
  return fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function awaitServer(url, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/// Serves the existing build on a port of its own, and for WebKit puts https in front of it.
/// AUTH_URL is set to the address the browser actually uses: CI exports AUTH_URL for the e2e
/// suite's server on 3100, and Auth.js would otherwise send every sign-in there.
async function withServer({ https }, fn) {
  const port = await freePort();
  let proxy = null;
  let base = `http://127.0.0.1:${port}`;
  if (https) {
    const { startHttpsProxy } = await import("../iphone/https-proxy.mjs");
    proxy = await startHttpsProxy({ port: 0, target: port });
    base = `https://localhost:${proxy.port}`;
  }
  const child = spawn("npx", ["next", "start", "-p", String(port), "--keepAliveTimeout", "70000"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), AUTH_URL: base, NEXTAUTH_URL: base, AUTH_TRUST_HOST: "true" },
    stdio: "ignore",
  });
  try {
    if (!(await awaitServer(`http://127.0.0.1:${port}/api/health`, 90_000))) {
      return [finding("major", "the local server never came up", `Waited 90s for http://127.0.0.1:${port}.`)];
    }
    return await fn(base);
  } finally {
    child.kill("SIGTERM");
    await proxy?.close();
  }
}

function loadAccepted() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "qa", "iphone", "accepted.json"), "utf8")).accepted ?? [];
  } catch {
    return [];
  }
}

function matches(entry, f) {
  const m = entry.match;
  if (m.check && m.check !== f.check) return false;
  if (m.severity && m.severity !== f.severity) return false;
  if (m.route && m.route !== f.route) return false;
  if (m.modal && !(f.modal ?? "").includes(m.modal)) return false;
  if (m.text && !(f.el?.text ?? "").includes(m.text)) return false;
  return true;
}

const elKey = (el) => (el ? `${el.tag}|${el.text}|${el.cls}|${el.path.replace(/:nth-of-type\(\d+\)/g, "")}` : "page");
const elName = (el) => (el ? `<${el.tag}>${el.text ? ` "${el.text.slice(0, 40)}"` : ""}` : "the page");
const short = (d) => d.replace(/^iPhone /, "");

/// Visits -> one QA finding per (screen, check, element, dialog), with the devices and roles it
/// was seen on. `pick(f)` returns the QA severity for a page finding, or null to drop it.
function summarise(result, pick, { staleCheck }) {
  const accepted = loadAccepted();
  const used = new Set();
  const groups = new Map();
  const add = (key, sev, title, detail, device, role) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { sev, title, detail, devices: new Set(), roles: new Set() }));
    g.devices.add(short(device));
    g.roles.add(role);
  };

  for (const v of result.visits) {
    if (["error-boundary"].includes(v.outcome) || /^http-5/.test(v.outcome ?? "")) {
      add(`crash|${v.route}`, "blocker", `${v.route}: the screen crashes (${v.outcome})`, `Opened as ${v.url}.`, v.device, v.role);
      continue;
    }
    if (v.outcome === "error") {
      add(`error|${v.route}`, "major", `${v.route}: could not be checked`, v.error ?? "", v.device, v.role);
      continue;
    }
    const all = [...v.findings.map((f) => ({ ...f, modal: null })), ...v.modals.flatMap((m) => m.findings.map((f) => ({ ...f, modal: m.trigger })))];
    for (const raw of all) {
      const f = { ...raw, route: v.route };
      if (f.severity === "info") continue;
      let sev = pick(f);
      if (!sev) continue;
      const hit = accepted.findIndex((a) => matches(a, f));
      if (hit >= 0) {
        // One line per decision, however many screens it shows up on.
        used.add(hit);
        const a = accepted[hit];
        add(`accepted|${hit}`, "info", `accepted: ${JSON.stringify(a.match)}`, `${a.reason} (${a.decidedBy}, ${a.acceptedOn})`, v.device, v.role);
        continue;
      }
      const where = f.modal ? ` in the "${f.modal}" dialog` : "";
      const extra = f.widest?.length ? `\nWidest elements: ${f.widest.join("; ")}` : "";
      add(`${f.check}|${v.route}|${f.modal ?? ""}|${elKey(f.el)}`, sev, `${v.route}: ${CHECK_LABEL[f.check] ?? f.check}${where}, ${elName(f.el)}`, f.message + extra, v.device, v.role);
    }
  }

  const out = [...groups.values()].map((g) =>
    finding(g.sev, g.title, `${g.detail}\nSeen on: ${[...g.devices].join(", ")} as ${[...g.roles].join(", ")}`),
  );
  if (staleCheck) {
    accepted.forEach((a, i) => {
      if (!used.has(i)) out.push(finding("minor", `stale acceptance in qa/iphone/accepted.json: ${JSON.stringify(a.match)}`, "Nothing matched it in this full run. Remove the entry; what it excused is gone."));
    });
  }
  const opened = result.visits.filter((v) => v.outcome === "ok").length;
  out.push(finding("info", `${result.visits.length} visits, ${opened} screens checked in ${result.seconds}s`, `${result.engine}, ${result.devices.join(", ")}; roles ${result.roles.join(", ")}`));
  return out;
}

/** Level 2: what blocks use, in Chromium, two iPhones, two roles. */
export async function phoneQuick() {
  const { audit } = await import("../iphone/audit.mjs");
  return withServer({ https: false }, async (base) => {
    const result = await audit({ base, engine: "chromium", devices: QUICK_DEVICES, roles: QUICK_ROLES, shots: false, concurrency: 4 });
    const blocking = (f) => {
      if (f.check === "horizontal-overflow") return "blocker";
      if (f.check === "modal-height" && f.severity === "critical") return "blocker";
      if (f.check === "input-font") return "blocker";
      if (f.check === "off-screen" && f.severity === "high") return "blocker";
      return null;
    };
    return summarise(result, blocking, { staleCheck: false });
  });
}

/** Level 3: the whole audit in WebKit. Builds first when this shard has no build of its own. */
export async function iphoneFull() {
  if (!buildPresent()) {
    const r = await sh("npx", ["next", "build"], { timeoutMs: 20 * 60_000, env: { SKIP_ENV_VALIDATION: "1" } });
    const stopped = timedOutFinding(r, "Production build for the iPhone audit");
    if (stopped) return [stopped];
    if (r.code !== 0) return [finding("blocker", "next build failed before the iPhone audit", r.all.split("\n").slice(-30).join("\n"))];
  }
  const { audit } = await import("../iphone/audit.mjs");
  return withServer({ https: true }, async (base) => {
    const result = await audit({ base, engine: "webkit", shots: false, concurrency: 4 });
    return summarise(result, (f) => SEVERITY_FULL[f.severity] ?? null, { staleCheck: true });
  });
}

/** Null when WebKit can start here, otherwise the reason. */
export async function webkitMissing() {
  try {
    const { webkit } = await import("playwright");
    const b = await webkit.launch();
    await b.close();
    return null;
  } catch (e) {
    return `WebKit cannot start (${String(e.message || e).split("\n")[0].slice(0, 120)}); the workflow installs it for the iphone shard only`;
  }
}
