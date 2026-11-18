#!/usr/bin/env node
// iPhone display audit of the product screens.
//
// Signs in as each seeded demo role, opens every `screen:` capability in
// qa/manifest.json (dynamic routes resolved from seeded rows) with iPhone
// device profiles, locale he-IL, and runs the layout checks in
// qa/iphone/checks.mjs on each screen and on the dialogs it opens.
//
// Two ways in:
//   - by hand: `node qa/iphone/audit.mjs` against a running server, writes
//     qa/reports/iphone/results.json; qa/iphone/report.mjs turns that into
//     report.md (see qa/iphone/README.md);
//   - from the QA runner: qa/checks/iphone.mjs imports `audit()` for the
//     level-2 "Phone layout" check and the level-3 "iPhone layout" check.
//
// Read-only towards the product with one exception: if the seeded database
// has no process for the demo client, one "[DEMO]" process is inserted so
// the four process routes can be opened. Run it against a throwaway
// database only (npm run db:dev locally, the service container in CI).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pageChecks } from "./checks.mjs";

export const ALL_DEVICES = ["iPhone SE", "iPhone SE (3rd gen)", "iPhone 15", "iPhone 15 Pro Max"];
export const OUT = path.join("qa", "reports", "iphone");

const PASSWORD = "DemoPass!2026";
// Same accounts as qa/e2e/auth.setup.ts (DEMO). `name` is typed into the confidentiality gate.
export const ROLES = {
  superadmin: { identifier: "demo.superadmin@ankora.co.il", name: "[DEMO] מנהל-על" },
  admin: { identifier: "demo.admin@ankora.co.il", name: "[DEMO] מנהל Ankora" },
  employee1: { identifier: "demo.employee1@ankora.co.il", name: "[DEMO] עובד Ankora - נועה" },
  clientadmin: { identifier: "demo.clientadmin@ankora.co.il", name: null },
  anon: null, // public screens only
};

// Screens reachable without a session. Visited as `anon`; signed-in roles skip them.
const PUBLIC_SCREENS = new Set([
  "/app/login",
  "/app/forgot-password",
  "/app/reset-password",
  "/app/login-link",
  "/app/login-link/request",
  "/agreements/sign/[token]",
  "/agreements/upload/[token]",
  "/upload",
]);

// ------------------------------------------------------------------
// Dynamic ids from the seeded database.
// ------------------------------------------------------------------
async function resolveIds() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const client = (await db.client.findUnique({ where: { id: "demo-client-a" } })) ?? (await db.client.findFirst({ where: { name: { startsWith: "[DEMO]" } } }));
    if (!client) throw new Error("no [DEMO] client: run npm run db:seed first");
    let proc = await db.process.findFirst({ where: { clientId: client.id }, orderBy: { seq: "asc" } });
    let createdProcess = false;
    if (!proc) {
      proc = await db.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "[DEMO] תהליך לבדיקת תצוגה באייפון", purpose: "נוצר על ידי qa/iphone/audit.mjs כדי לפתוח את מסכי התהליך" } });
      createdProcess = true;
    }
    const category = await db.category.findFirst({ orderBy: { name: "asc" } });
    const date = (await db.importantDate.findFirst({ where: { clientId: client.id } })) ?? (await db.importantDate.findFirst());
    const user = await db.user.findFirst({ where: { email: ROLES.employee1.identifier } });
    const task = (await db.task.findFirst({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } })) ?? (await db.task.findFirst());
    return {
      clientId: client.id,
      processId: proc.id,
      categoryId: category?.id,
      importantDateId: date?.id,
      userId: user?.id,
      taskId: task?.id,
      // Tokens are stored hashed, so a real one cannot be read back. The token screens are opened
      // with an unknown token and show their "link not valid" state.
      token: "iphone-audit-unknown-token",
      createdProcess,
    };
  } finally {
    await db.$disconnect();
  }
}

function expand(route, ids) {
  return route
    .replace("[clientId]", ids.clientId)
    .replace("[processId]", ids.processId)
    .replace("[categoryId]", ids.categoryId)
    .replace("[userId]", ids.userId)
    .replace("[token]", ids.token)
    .replace(/^\/app\/important-dates\/\[id\]$/, `/app/important-dates/${ids.importantDateId}`)
    .replace(/^\/app\/tasks\/\[id\]$/, `/app/tasks/${ids.taskId}`);
}

const slug = (route) => route.replace(/^\//, "").replace(/\[|\]/g, "").replace(/\//g, "__") || "root";
const devSlug = (d) => d.toLowerCase().replace(/\s+/g, "-");

/** Every `screen:` capability in the manifest, optionally narrowed by route prefix. */
export function manifestScreens(only = null) {
  const manifest = JSON.parse(fs.readFileSync(path.join("qa", "manifest.json"), "utf8"));
  let screens = Object.entries(manifest.capabilities)
    .filter(([, c]) => c.kind === "screen")
    .map(([id]) => id.slice("screen:".length))
    .sort();
  if (only) screens = screens.filter((s) => only.some((o) => s === o || s.startsWith(o)));
  return screens;
}

// ------------------------------------------------------------------
// Sign-in, once per role, saved as storage state.
// ------------------------------------------------------------------
async function signIn(browser, devices, base, authDir, role) {
  const acct = ROLES[role];
  if (!acct) return null;
  const file = path.join(authDir, `${role}.json`);
  const ctx = await browser.newContext({ ...devices["iPhone SE"], locale: "he-IL", timezoneId: "Asia/Jerusalem", baseURL: base, ignoreHTTPSErrors: true });
  try {
    const page = await ctx.newPage();
    await page.goto("/app/login");
    await page.fill('input[name="identifier"]', acct.identifier);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith("/app") && !u.pathname.includes("/login"), { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    if (acct.name) {
      if (!new URL(page.url()).pathname.startsWith("/app/agreements/confidentiality")) {
        await page.goto("/app/agreements/confidentiality").catch(() => page.goto("/app/agreements/confidentiality"));
      }
      await page.waitForLoadState("networkidle").catch(() => {});
      if (new URL(page.url()).pathname.startsWith("/app/agreements/confidentiality")) {
        await page.getByLabel("קראתי את ההתחייבות ואני מסכים/ה לה").check();
        await page.locator('input[name="signedName"]').fill(acct.name);
        await page.getByRole("button", { name: "אישור וחתימה" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/app/agreements"), { timeout: 30_000 });
      }
    }
    fs.mkdirSync(authDir, { recursive: true });
    await ctx.storageState({ path: file });
    return file;
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------
// One screen.
// ------------------------------------------------------------------
const DENY = /מחק|מחיק|הסר|השה|התחל|עצור|שלח|אשר|אישור|דח|יציאה|התנתק|הפעל|בטל|סיים|העתק|ייצ|הורד|רענן|שמור|שמיר|חתימ|חתום|קבל|delete|remove|start|stop|send|approve|reject|logout|sign|cancel|export|download|copy|save|submit/i;

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(300);
}

async function runChecks(page) {
  return page.evaluate(`(${pageChecks.toString()})()`);
}

async function tagDialogFindings(page, findings) {
  // Which findings sit inside an open dialog: re-resolve by path.
  return page.evaluate((fs) => {
    const d = document.querySelector('[role=dialog], [aria-modal="true"], dialog[open]');
    return fs.map((f) => {
      if (!d || !f.el) return { ...f, inDialog: f.check === "modal-height" };
      let inside = false;
      try {
        const el = document.querySelector(f.el.path);
        inside = !!el && d.contains(el);
      } catch {}
      return { ...f, inDialog: inside || f.check === "modal-height" };
    });
  }, findings);
}

async function hasDialog(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role=dialog], [aria-modal="true"], dialog[open]');
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

async function shoot(page, opts, file, fullPage, meta) {
  if (!opts.shots) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // WebKit refuses screenshots taller than 32767px (the guide is). Keep the top 32000px then.
  const tall = fullPage && (meta?.scrollHeight ?? 0) > 32000;
  await page.screenshot({ path: file, fullPage, type: "jpeg", quality: 75, scale: "css", ...(tall ? { clip: { x: 0, y: 0, width: meta.vw, height: 32000 } } : {}) });
  return path.relative(OUT, file);
}

async function visit(page, opts, { role, device, route, url, shotDir }) {
  const rec = { role, device, route, url, status: null, finalUrl: null, outcome: null, findings: [], meta: null, shot: null, modals: [], pageErrors: [] };
  const errs = [];
  const onErr = (e) => errs.push(String(e.message || e).slice(0, 200));
  page.on("pageerror", onErr);
  try {
    const resp = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    rec.status = resp?.status() ?? null;
    await settle(page);
    rec.finalUrl = page.url();
    const want = new URL(url, opts.base).pathname.replace(/\/$/, "");
    const got = new URL(page.url()).pathname.replace(/\/$/, "");
    if (got !== want) {
      rec.outcome = "redirected";
      return rec;
    }
    rec.outcome = rec.status && rec.status >= 400 ? `http-${rec.status}` : "ok";
    // The app's error boundary ("משהו השתבש") renders with a 200.
    const crashed = await page.evaluate(() => /משהו השתבש|Something went wrong|Application error/.test(document.body.innerText));
    if (crashed && rec.outcome === "ok") rec.outcome = "error-boundary";
    // A role without access gets an in-place "no permission" card at the same URL. Not a layout
    // subject for that role; recorded and skipped.
    const forbidden = await page.evaluate(() => /אין לך הרשאה/.test(document.querySelector("main")?.innerText ?? document.body.innerText) && (document.querySelector("main")?.innerText ?? "").length < 200);
    if (forbidden && rec.outcome === "ok") {
      rec.outcome = "forbidden";
      return rec;
    }
    const res = await runChecks(page);
    rec.findings = res.findings;
    rec.meta = res.meta;
    rec.shot = await shoot(page, opts, path.join(shotDir, `${slug(route)}.jpg`), true, res.meta);
    if (opts.probe) await probeModals(page, opts, rec, url, shotDir, route);
  } catch (e) {
    rec.outcome = "error";
    rec.error = String(e.message || e).split("\n")[0].slice(0, 300);
  } finally {
    rec.pageErrors = errs;
    page.off("pageerror", onErr);
  }
  return rec;
}

async function probeModals(page, opts, rec, url, shotDir, route) {
  // Candidates: the bottom-nav "more" button plus up to 4 plain buttons that look like they open
  // something (not inside a form, not in a destructive or submitting wording).
  const handles = await page.evaluateHandle((denySrc) => {
    const deny = new RegExp(denySrc, "i");
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const more = Array.from(document.querySelectorAll("nav button[aria-expanded]")).filter(vis);
    const rest = Array.from(document.querySelectorAll('button[type="button"], button:not([type])'))
      .filter(vis)
      .filter((b) => !b.closest("form, nav, [role=dialog]") && !b.disabled)
      .filter((b) => !deny.test((b.innerText || "") + " " + (b.getAttribute("aria-label") || "")))
      .filter((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().length > 0);
    return [...more.slice(0, 1), ...rest.slice(0, 4)];
  }, DENY.source);
  const count = await handles.evaluate((a) => a.length);
  for (let i = 0; i < count; i++) {
    try {
      const btn = await handles.evaluateHandle((a, i) => a[i], i);
      const el = btn.asElement();
      if (!el || !(await el.isVisible())) continue;
      const label = (await el.evaluate((b) => (b.getAttribute("aria-label") || b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40))) || `button ${i}`;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 3_000 });
      await page.waitForTimeout(700);
      if (new URL(page.url()).pathname !== new URL(url, opts.base).pathname) {
        await page.goto(url, { waitUntil: "load" });
        await settle(page);
        break; // handles are stale now
      }
      if (!(await hasDialog(page))) continue;
      await page.waitForTimeout(300);
      const res = await runChecks(page);
      const tagged = (await tagDialogFindings(page, res.findings)).filter((f) => f.inDialog);
      const shot = await shoot(page, opts, path.join(shotDir, `${slug(route)}__modal-${rec.modals.length + 1}.jpg`), false);
      rec.modals.push({ trigger: label, shot, findings: tagged });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if (await hasDialog(page)) {
        // Close through its close button, else reload.
        const closed = await page.evaluate(() => {
          const d = document.querySelector('[role=dialog], [aria-modal="true"], dialog[open]');
          const b = d?.querySelector("button[aria-label]");
          if (b) b.click();
          return !!b;
        });
        await page.waitForTimeout(300);
        if (!closed || (await hasDialog(page))) {
          await page.goto(url, { waitUntil: "load" });
          await settle(page);
          break;
        }
      }
    } catch {
      // a candidate that cannot be clicked is not a finding
    }
  }
}

async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        results[k] = await fn(items[k], k);
      }
    }),
  );
  return results;
}

/**
 * Runs the audit and returns { ids, devices, roles, seconds, visits }.
 *
 * engine: "webkit" (the real thing, needs https in front of the server, see
 *   https-proxy.mjs) or "chromium" (iPhone viewport and touch, but Chrome's
 *   layout: right for overflow, crashes and sizes, blind to Safari-only
 *   behaviour such as input zoom; it can talk to plain http on loopback).
 */
export async function audit(options = {}) {
  const opts = {
    base: "https://localhost:3443",
    engine: "webkit",
    devices: ALL_DEVICES,
    roles: Object.keys(ROLES),
    only: null,
    concurrency: 4,
    probe: true,
    shots: true,
    log: () => {},
    ...options,
  };
  opts.base = opts.base.replace(/\/$/, "");
  const pw = await import("playwright");
  const launcher = pw[opts.engine];
  const exe = opts.engine === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM : undefined;
  const authDir = path.join(OUT, ".auth", opts.engine);
  const screens = manifestScreens(opts.only);
  const ids = await resolveIds();
  opts.log(`${screens.length} screens, roles ${opts.roles.join(",")}, devices ${opts.devices.join(" | ")}, ${opts.engine}`);
  if (ids.createdProcess) opts.log(`inserted a [DEMO] process ${ids.processId} (none was seeded)`);

  const browser = await launcher.launch(exe ? { executablePath: exe } : {});
  const started = Date.now();
  try {
    const states = {};
    for (const role of opts.roles) states[role] = await signIn(browser, pw.devices, opts.base, authDir, role);

    const jobs = [];
    for (const role of opts.roles)
      for (const device of opts.devices) {
        const list = screens.filter((s) => (role === "anon" ? PUBLIC_SCREENS.has(s) || s === "/app/oauth/consent" : !PUBLIC_SCREENS.has(s) || s === "/upload"));
        jobs.push({ role, device, list });
      }

    const visits = (
      await pool(jobs, opts.concurrency, async ({ role, device, list }) => {
        // Chromium cannot take Safari's user agent and still be Chromium; keep the
        // viewport, scale and touch of the device, and Chromium's own engine.
        const { defaultBrowserType, ...profile } = pw.devices[device];
        const ctx = await browser.newContext({
          ...profile,
          locale: "he-IL",
          timezoneId: "Asia/Jerusalem",
          baseURL: opts.base,
          ignoreHTTPSErrors: true,
          storageState: states[role] ?? undefined,
        });
        try {
          const page = await ctx.newPage();
          const shotDir = path.join(OUT, "shots", devSlug(device), role);
          const recs = [];
          for (const route of list) {
            const rec = await visit(page, opts, { role, device, route, url: expand(route, ids), shotDir });
            recs.push(rec);
            const n = rec.findings.length + rec.modals.reduce((a, m) => a + m.findings.length, 0);
            opts.log(`${device.padEnd(18)} ${role.padEnd(11)} ${rec.outcome.padEnd(10)} ${String(n).padStart(3)}  ${route}`);
          }
          return recs;
        } finally {
          await ctx.close();
        }
      })
    ).flat();
    return { ids, devices: opts.devices, roles: opts.roles, engine: opts.engine, seconds: Math.round((Date.now() - started) / 1000), visits };
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------
// By hand.
//   node qa/iphone/audit.mjs [--base https://localhost:3443] [--engine webkit|chromium]
//        [--roles admin,employee1] [--devices "iPhone SE"] [--only /app/tasks]
//        [--concurrency 4] [--no-probe] [--no-shots] [--append]
// ------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const arg = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const list = (v) => (v ? v.split(",").map((s) => s.trim()) : null);
  const result = await audit({
    base: arg("base", process.env.QA_BASE_URL ?? "https://localhost:3443"),
    engine: arg("engine", "webkit"),
    devices: list(arg("devices", null)) ?? ALL_DEVICES,
    roles: list(arg("roles", null)) ?? Object.keys(ROLES),
    only: list(arg("only", null)),
    concurrency: Number(arg("concurrency", 4)),
    probe: !args.includes("--no-probe"),
    shots: !args.includes("--no-shots"),
    log: (m) => console.log(`[iphone] ${m}`),
  });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "results.json");
  let { visits, devices, roles } = result;
  // --append: add these visits to an earlier results.json (e.g. one more device), replacing any
  // visit for the same role, device and screen.
  if (args.includes("--append") && fs.existsSync(file)) {
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    const key = (v) => `${v.role}|${v.device}|${v.route}`;
    const fresh = new Set(visits.map(key));
    visits = [...prev.visits.filter((v) => !fresh.has(key(v))), ...visits];
    devices = [...new Set([...prev.devices, ...devices])];
    roles = [...new Set([...prev.roles, ...roles])];
  }
  const out = { generatedAt: new Date().toISOString(), base: arg("base", "https://localhost:3443"), ...result, devices, roles, visits };
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`[iphone] ${visits.length} visits in ${result.seconds}s -> ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
