// Screenshots for the in-app guide (ADR 0006, 12.11.2026: the guide gets
// English screenshots too).
//
// Runs against a local server with the demo data (prisma/seed), signs in
// as the demo user each picture is taken as, switches that user's interface
// language, and writes public/guide/<name>.png (Hebrew) or
// public/guide/en/<name>.png (English). The Hebrew set was taken by hand;
// this script can retake it the same way when a screen changes.
//
//   node scripts/guide-screenshots.mjs --lang=en [--base=http://localhost:3100] [--only=tasks,timer]
//
// Demo data: scripts/seed-guide-he.ts for the Hebrew set and
// scripts/seed-guide-en.ts for the English one, each into its own fresh
// local database (the steps are at the top of each seed). prisma/seed.ts
// alone is too thin: most screens come out empty.
//
// Every picture is 1400 pixels wide at device scale 2 (2800 in the file),
// like the existing set. `full` pictures take the whole page; `card`
// pictures crop to the card whose heading is given.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const LANG = args.lang === "he" ? "he" : "en";
const BASE = args.base ?? "http://localhost:3100";
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const OUT = path.join(process.cwd(), "public", "guide", ...(LANG === "en" ? ["en"] : []));
const PASSWORD = process.env.GUIDE_DEMO_PASSWORD ?? "DemoPass!2026";

const SUPER = "demo.superadmin@ankora.co.il";
const EMPLOYEE = "demo.employee1@ankora.co.il";
const CLIENT = "demo.clientadmin@ankora.co.il";

/// The shots, in the order the guide shows them. `card` is the heading of
/// the card to crop to, per language.
export const SHOTS = [
  { name: "login", path: "/app/login", user: null },
  { name: "overview", path: "/app", user: SUPER, full: true },
  { name: "timer", path: "/app/timer", user: EMPLOYEE },
  { name: "my-time", path: "/app/timer?tab=mine", user: EMPLOYEE },
  { name: "tasks", path: "/app/tasks", user: SUPER },
  { name: "task-detail", path: "/app/tasks/demo-task-research-competitors", user: SUPER, full: true },
  { name: "calendar", path: "/app/calendar", user: SUPER, full: true },
  { name: "important-dates", path: "/app/important-dates", user: SUPER },
  { name: "clients", path: "/app/clients", user: SUPER },
  { name: "credentials", path: "/app/credentials?clientId=demo-client-a", user: SUPER },
  { name: "categories", path: "/app/categories", user: SUPER },
  { name: "client-file-tab", path: "/app/clients/demo-client-a?tab=file", user: SUPER, full: true },
  // Built in Hebrew whatever the reader's language (client-file-view.ts),
  // so only the Hebrew set has it.
  { name: "client-file-read", path: "/app/clients/demo-client-a/client-file", user: SUPER, full: true, langs: ["he"] },
  { name: "client-processes", path: "/app/clients/demo-client-a?tab=file&section=processes", user: SUPER, selector: "#processes" },
  { name: "client-connections", path: "/app/clients/demo-client-a/connections", user: SUPER },
  { name: "client-rules", path: "/app/clients/demo-client-a?tab=file", user: SUPER, card: { he: "כללים של הלקוח", en: "Client rules" } },
  { name: "approvals", path: "/app/approvals", user: SUPER },
  { name: "knowledge-review", path: "/app/knowledge", user: SUPER, full: true },
  { name: "extraction-guide", path: "/app/extraction-guide", user: SUPER },
  { name: "time-entries-admin", path: "/app/time-entries", user: SUPER },
  { name: "users", path: "/app/users", user: SUPER },
  { name: "audit-log", path: "/app/audit-log", user: SUPER },
  { name: "integrations", path: "/app/integrations", user: SUPER },
  { name: "claude-usage", path: "/app/claude-usage", user: SUPER, full: true },
  { name: "hour-banks", path: "/app/hour-banks?clientId=demo-client-a", user: SUPER, full: true },
  { name: "alerts", path: "/app/alerts?clientId=demo-client-a", user: SUPER, full: true },
  { name: "reports", path: "/app/reports", user: SUPER },
  { name: "report-schedules", path: "/app/report-schedules?clientId=demo-client-a", user: SUPER },
  { name: "portal-home", path: "/app/portal", user: CLIENT, full: true },
  { name: "portal-decisions", path: "/app/portal/decisions", user: CLIENT },
  { name: "portal-activity", path: "/app/portal/activity", user: CLIENT },
  { name: "portal-dashboard", path: "/app/portal/hours", user: CLIENT },
  { name: "portal-weekly", path: "/app/portal/weekly", user: CLIENT },
  { name: "portal-tasks", path: "/app/portal/hours?view=tasks", user: CLIENT },
  { name: "portal-history", path: "/app/portal/history", user: CLIENT },
  { name: "portal-file", path: "/app/portal/file", user: CLIENT, full: true },
  { name: "notifications", path: "/app/notifications", user: SUPER },
  { name: "profile", path: "/app/profile", user: SUPER, full: true },
  { name: "profile-passkeys", path: "/app/profile", user: SUPER, card: { he: "Passkey", en: "Passkey" } },
  // mcp-claude shows the Claude card of an account that is connected to
  // Claude, which the demo data has no way to be. It is not retaken.
];

async function signIn(context, email) {
  const page = await context.newPage();
  await page.goto(`${BASE}/app/login`);
  await page.fill('input[name="identifier"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000, waitUntil: "commit" });
  // Staff sign the confidentiality undertaking once (Hebrew only).
  await page.goto(`${BASE}/app/agreements/confidentiality`);
  await page.waitForLoadState("networkidle");
  if (new URL(page.url()).pathname.startsWith("/app/agreements/confidentiality")) {
    await page.getByLabel("קראתי את ההתחייבות ואני מסכים/ה לה").check();
    // The page greets the person by name; that is the name they sign with.
    const intro = await page.getByText("לפני הכניסה למערכת,").first().innerText();
    const name = intro.replace(/^.*לפני הכניסה למערכת,\s*/, "").replace(/,\s*יש לקרוא.*$/, "").trim();
    await page.locator('input[name="signedName"]').fill(name);
    await page.getByRole("button", { name: "אישור וחתימה" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/app/agreements"), { timeout: 30000, waitUntil: "commit" });
  }
  await page.goto(`${BASE}/app/profile`);
  await page.selectOption('[data-testid="profile-locale"]', LANG);
  await page.locator('[data-testid="profile-locale"]').locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  await page.waitForFunction((dir) => document.documentElement.dir === dir, LANG === "en" ? "ltr" : "rtl", { timeout: 30000 });
  return page;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // CHROMIUM_PATH: a browser other than the one this Playwright downloads.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const pages = new Map();
  const failed = [];
  try {
    for (const shot of SHOTS) {
      if (ONLY && !ONLY.has(shot.name)) continue;
      if (shot.langs && !shot.langs.includes(LANG)) continue;
      const key = shot.user ?? "anon";
      if (!pages.has(key)) {
        const context = await browser.newContext({
          viewport: { width: 1400, height: 820 },
          deviceScaleFactor: 2,
          locale: LANG === "en" ? "en-IL" : "he-IL",
          timezoneId: "Asia/Jerusalem",
        });
        if (!shot.user) {
          await context.addCookies([{ name: "ankora_app_locale", value: LANG, url: BASE }]);
          pages.set(key, await context.newPage());
        } else {
          pages.set(key, await signIn(context, shot.user));
        }
      }
      const page = pages.get(key);
      const file = path.join(OUT, `${shot.name}.png`);
      try {
        // A goto right after the language change can land mid-refresh; once more.
        await page.goto(`${BASE}${shot.path}`).catch(() => page.goto(`${BASE}${shot.path}`));
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts?.ready);
        // Next's development badge, if the server is `next dev`: a tool, never part of the guide.
        await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast],#__next-build-watcher,[data-next-badge-root]{display:none!important}" });
        // A screen the user may not open looks like a normal page in the picture.
        const text = await page.evaluate(() => document.body.innerText);
        if (/אין לך הרשאה|This page could not be found|You do not have permission/.test(text)) throw new Error("the page refused this user");
        if (shot.user && new URL(page.url()).pathname.startsWith("/app/login")) throw new Error("landed on the sign-in page");
        if (shot.selector) {
          // An element by id, clipped from the full page (see `card` below for why).
          await page.evaluate(() => window.scrollTo(0, 0));
          const box = await page.locator(shot.selector).first().boundingBox();
          if (!box) throw new Error(`no box for ${shot.selector}`);
          await page.screenshot({ path: file, fullPage: true, clip: box });
        } else if (shot.card) {
          // The heading as a pattern, so "Processes (3)" is not "Processes and procedures".
          const heading = page.getByText(new RegExp(shot.card[LANG])).first();
          const card = heading.locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
          // A clip of the full page, not an element screenshot: a card
          // taller than the window is scrolled through in pieces, and the
          // sticky page header gets drawn over the middle of it.
          await page.evaluate(() => window.scrollTo(0, 0));
          const box = await card.boundingBox();
          if (!box) throw new Error(`no box for the card "${shot.card[LANG]}"`);
          await page.screenshot({ path: file, fullPage: true, clip: box });
        } else {
          await page.screenshot({ path: file, fullPage: !!shot.full });
        }
        console.log("ok", shot.name);
      } catch (err) {
        failed.push(shot.name);
        console.log("FAILED", shot.name, String(err).split("\n")[0]);
      }
    }
  } finally {
    await browser.close();
  }
  // Two pictures with the same size in bytes are almost always the same
  // picture (the sign-in page, or a refusal), not two screens.
  const sizes = new Map();
  for (const shot of SHOTS) {
    const file = path.join(OUT, `${shot.name}.png`);
    if ((ONLY && !ONLY.has(shot.name)) || !fs.existsSync(file)) continue;
    const size = fs.statSync(file).size;
    sizes.set(size, [...(sizes.get(size) ?? []), shot.name]);
  }
  for (const names of sizes.values()) if (names.length > 1) console.log("SAME SIZE, look at them:", names.join(", "));
  if (failed.length) {
    console.log(`\n${failed.length} failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
