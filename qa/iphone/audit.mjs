#!/usr/bin/env node
// iPhone display audit of the product screens.
//
// Signs in as each seeded demo role, opens every `screen:` capability in
// qa/manifest.json (dynamic routes resolved from seeded rows) in WebKit with
// the iPhone SE, iPhone 15 and iPhone 15 Pro Max device profiles, locale
// he-IL, takes a full-page screenshot and runs the layout checks in
// qa/iphone/checks.mjs. Writes qa/reports/iphone/results.json; then
// qa/iphone/report.mjs turns that into report.md.
//
// Read-only towards the product with one exception: if the seeded database
// has no process for the demo client, one "[DEMO]" process is inserted so
// the four process routes can be opened. Run it against a throwaway local
// database only (npm run db:dev), never against a shared one.
//
// Usage (server already running, env from the local env file, without AUTH_URL/NEXTAUTH_URL so
// Auth.js follows the forwarded host):
//   node qa/iphone/https-proxy.mjs &          # https://localhost:3443 -> http://127.0.0.1:3100
//   node qa/iphone/audit.mjs [--base http://127.0.0.1:3100] [--roles admin,employee1]
//        [--devices "iPhone SE"] [--only /app/tasks] [--concurrency 4] [--no-probe]

import fs from "node:fs";
import path from "node:path";
import { webkit, devices } from "playwright";
import { PrismaClient } from "@prisma/client";
import { pageChecks } from "./checks.mjs";

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
// https, through qa/iphone/https-proxy.mjs: WebKit applies the CSP's upgrade-insecure-requests
// to http://127.0.0.1 (Chromium exempts loopback), so plain http loads no scripts at all.
const BASE = arg("base", process.env.QA_BASE_URL ?? "https://localhost:3443");
const DEVICES = arg("devices", "iPhone SE,iPhone SE (3rd gen),iPhone 15,iPhone 15 Pro Max").split(",").map((s) => s.trim());
const ONLY = arg("only", null);
const CONCURRENCY = Number(arg("concurrency", 4));
const PROBE = !args.includes("--no-probe");
const OUT = path.join("qa", "reports", "iphone");
const AUTH_DIR = path.join(OUT, ".auth");

const PASSWORD = "DemoPass!2026";
// Same accounts as qa/e2e/auth.setup.ts (DEMO). `name` is typed into the confidentiality gate.
const ROLES = {
  superadmin: { identifier: "demo.superadmin@ankora.co.il", name: "[DEMO] מנהל-על" },
  admin: { identifier: "demo.admin@ankora.co.il", name: "[DEMO] מנהל Ankora" },
  employee1: { identifier: "demo.employee1@ankora.co.il", name: "[DEMO] עובד Ankora - נועה" },
  clientadmin: { identifier: "demo.clientadmin@ankora.co.il", name: null },
  anon: null, // public screens only
};
const ROLE_LIST = arg("roles", Object.keys(ROLES).join(",")).split(",").map((s) => s.trim());

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
      id: null, // ambiguous name, resolved per route below
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

// ------------------------------------------------------------------
// Sign-in, once per role, saved as storage state.
// ------------------------------------------------------------------
async function signIn(browser, role) {
  const acct = ROLES[role];
  const file = path.join(AUTH_DIR, `${role}.json`);
  if (!acct) return null;
  const ctx = await browser.newContext({ ...devices["iPhone SE"], locale: "he-IL", timezoneId: "Asia/Jerusalem", baseURL: BASE, ignoreHTTPSErrors: true });
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
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
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

async function visit(page, { role, device, route, url, shotDir }) {
  const rec = { role, device, route, url, status: null, finalUrl: null, outcome: null, findings: [], meta: null, shot: null, modals: [], pageErrors: [] };
  const errs = [];
  const onErr = (e) => errs.push(String(e.message || e).slice(0, 200));
  page.on("pageerror", onErr);
  try {
    const resp = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    rec.status = resp?.status() ?? null;
    await settle(page);
    rec.finalUrl = page.url();
    const want = new URL(url, BASE).pathname.replace(/\/$/, "");
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
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = path.join(shotDir, `${slug(route)}.jpg`);
    // WebKit refuses screenshots taller than 32767px (the guide is). Keep the top 32000px then.
    const tall = (res.meta?.scrollHeight ?? 0) > 32000;
    await page.screenshot({ path: shot, fullPage: true, type: "jpeg", quality: 75, scale: "css", ...(tall ? { clip: { x: 0, y: 0, width: res.meta.vw, height: 32000 } } : {}) });
    if (tall) rec.shotNote = `cropped to the top 32000px of ${res.meta.scrollHeight}px`;
    rec.shot = path.relative(OUT, shot);

    if (PROBE) await probeModals(page, rec, url, shotDir, route);
  } catch (e) {
    rec.outcome = "error";
    rec.error = String(e.message || e).split("\n")[0].slice(0, 300);
  } finally {
    rec.pageErrors = errs;
    page.off("pageerror", onErr);
  }
  return rec;
}

async function hasDialog(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role=dialog], [aria-modal="true"], dialog[open]');
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

async function probeModals(page, rec, url, shotDir, route) {
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
      if (new URL(page.url()).pathname !== new URL(url, BASE).pathname) {
        await page.goto(url, { waitUntil: "load" });
        await settle(page);
        break; // handles are stale now
      }
      if (!(await hasDialog(page))) continue;
      await page.waitForTimeout(300);
      const res = await runChecks(page);
      const tagged = (await tagDialogFindings(page, res.findings)).filter((f) => f.inDialog);
      const shot = path.join(shotDir, `${slug(route)}__modal-${rec.modals.length + 1}.jpg`);
      await page.screenshot({ path: shot, type: "jpeg", quality: 75, scale: "css" });
      rec.modals.push({ trigger: label, shot: path.relative(OUT, shot), findings: tagged });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if (await hasDialog(page)) {
        // Close through its close button, else reload.
        const closed = await page.evaluate(() => {
          const d = document.querySelector('[role=dialog], [aria-modal="true"], dialog[open]');
          const b = d?.querySelector('button[aria-label]');
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

// ------------------------------------------------------------------
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

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join("qa", "manifest.json"), "utf8"));
  let screens = Object.entries(manifest.capabilities)
    .filter(([, c]) => c.kind === "screen")
    .map(([id]) => id.slice("screen:".length))
    .sort();
  if (ONLY) screens = screens.filter((s) => ONLY.split(",").some((o) => s === o || s.startsWith(o)));

  const ids = await resolveIds();
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`[iphone] ${screens.length} screens, roles ${ROLE_LIST.join(",")}, devices ${DEVICES.join(" | ")}`);
  if (ids.createdProcess) console.log(`[iphone] inserted a [DEMO] process ${ids.processId} (none was seeded)`);

  const browser = await webkit.launch();
  const states = {};
  for (const role of ROLE_LIST) states[role] = await signIn(browser, role);

  const jobs = [];
  for (const role of ROLE_LIST)
    for (const device of DEVICES) {
      const list = screens.filter((s) => (role === "anon" ? PUBLIC_SCREENS.has(s) || s === "/app/oauth/consent" : !PUBLIC_SCREENS.has(s) || s === "/upload"));
      jobs.push({ role, device, list });
    }

  const started = Date.now();
  const all = (
    await pool(jobs, CONCURRENCY, async ({ role, device, list }) => {
      const ctx = await browser.newContext({
        ...devices[device],
        locale: "he-IL",
        timezoneId: "Asia/Jerusalem",
        baseURL: BASE,
        ignoreHTTPSErrors: true,
        storageState: states[role] ?? undefined,
      });
      const page = await ctx.newPage();
      const shotDir = path.join(OUT, "shots", devSlug(device), role);
      const recs = [];
      for (const route of list) {
        const url = expand(route, ids);
        const rec = await visit(page, { role, device, route, url, shotDir });
        recs.push(rec);
        const n = rec.findings.length + rec.modals.reduce((a, m) => a + m.findings.length, 0);
        console.log(`[iphone] ${device.padEnd(18)} ${role.padEnd(11)} ${rec.outcome.padEnd(10)} ${String(n).padStart(3)}  ${route}`);
      }
      await ctx.close();
      return recs;
    })
  ).flat();
  await browser.close();

  // --append: add these visits to an earlier results.json (e.g. one more device), replacing any
  // visit for the same role, device and screen.
  if (args.includes("--append") && fs.existsSync(path.join(OUT, "results.json"))) {
    const prev = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
    const key = (v) => `${v.role}|${v.device}|${v.route}`;
    const fresh = new Set(all.map(key));
    all.unshift(...prev.visits.filter((v) => !fresh.has(key(v))));
    DEVICES.splice(0, DEVICES.length, ...new Set([...prev.devices, ...DEVICES]));
    ROLE_LIST.splice(0, ROLE_LIST.length, ...new Set([...prev.roles, ...ROLE_LIST]));
  }
  const out = { generatedAt: new Date().toISOString(), base: BASE, devices: DEVICES, roles: ROLE_LIST, ids, seconds: Math.round((Date.now() - started) / 1000), visits: all };
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(out, null, 1));
  console.log(`[iphone] ${all.length} visits in ${out.seconds}s -> ${path.join(OUT, "results.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
