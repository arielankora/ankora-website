// Level 3 - accessibility and RTL, against a running server.
//
// The interesting part is how contrast is measured. A token's nominal value is not what
// the eye receives: every ancestor background is composited down onto the page ground,
// AND the element's own background is included. Both halves of that matter here and
// both were learned the hard way.
//
// Compositing the ancestors is how the `elevated`-inside-a-grid trap was found -- an
// .04 cream wash landing on a grid's own .11 wash lifted the ground to #2D394B, where
// gold measures 3.77:1 and every other foreground was wrong by about a third of a stop.
// Including the element's own layer is the other half: an earlier version that skipped
// it reported the gold CTA button, which is navy text on a gold fill, as 1:1.
//
// Targets use the WCAG 2.2 AA floor of 24x24 (SC 2.5.8), not the AAA 44x44 of SC 2.5.5,
// and inline links inside running prose are exempt from 2.5.8 entirely.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { finding } from "../lib/report.mjs";
import { ROOT } from "../lib/discover.mjs";

const WIDTHS = [1440, 1024, 768, 390];
const LOCALES = ["he", "en"];
const PATHS = [
  "", "/about", "/contact", "/coverage", "/how-it-works", "/pricing", "/roi",
  "/solutions", "/technology", "/privacy", "/terms", "/blog",
  "/personal-operations-management", "/ankora-vs-personal-assistant",
  "/ankora-vs-ai-assistants",
  "/personal-assistant-for-executives",
  // The evidence section. The hub is a new layout (portrait + row) rather than a
  // variant of an existing one, and the story page is the only long-form page on
  // the marketing site, so neither is covered by any path above.
  //
  // One story is named on purpose. This list samples LAYOUTS, not URLs - every
  // story renders through the same component, so the second one would re-test
  // the same CSS at four widths in two locales for nothing. The complete route
  // sweep lives in qa/e2e/routes.ts, which derives itself from the content.
  "/customer-stories", "/customer-stories/gilad-komorov",
];

/** Runs in the page. Kept as one function so it can be passed to page.evaluate. */
function auditPage() {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
  const ground = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg[3] > 0) stack.push(bg);
    }
    let base = [11, 27, 51];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const lum = (rgb) => {
    const f = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const ratio = (a, b) => {
    const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
    return (hi + 0.05) / (lo + 0.05);
  };

  const out = { contrast: [], targets: [], fields: [], headings: [], h1: 0, overflow: false };
  out.overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  out.h1 = document.querySelectorAll("h1").length;

  for (const el of document.querySelectorAll("body *")) {
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const g = ground(el);
    const size = parseFloat(cs.fontSize);
    const weight = +cs.fontWeight || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, g), g);
    if (got < need) {
      out.contrast.push({ text: el.textContent.trim().slice(0, 40), colour: cs.color, got: +got.toFixed(2), need, size });
    }
  }

  for (const el of document.querySelectorAll('a,button,input,select,textarea,[role="button"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const p = el.parentElement;
    const inlineInSentence =
      el.tagName === "A" && p && getComputedStyle(el).display.startsWith("inline") &&
      [...p.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
    if (inlineInSentence) continue;
    // Half a pixel of tolerance. Sub-pixel layout routinely gives a link a measured
    // height of 23.99 where every rule in the stylesheet says 24, and the first run of
    // this check reported 128 of those -- every one of them printed as "305x24 below
    // the 24x24 floor", a sentence that contradicts itself. A defect a reader can see
    // is nonsense is worse than no check, because it trains them to skim the whole
    // section. The measurements are reported to one decimal for the same reason.
    const MIN = 23.5;
    if (r.width < MIN || r.height < MIN) {
      out.targets.push({
        text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
      });
    }
  }

  for (const f of document.querySelectorAll("input,select,textarea")) {
    if (f.type === "hidden") continue;
    if (!(f.labels?.length || f.getAttribute("aria-label") || f.getAttribute("aria-labelledby"))) {
      out.fields.push(f.name || f.type);
    }
  }

  let prev = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const lvl = +h.tagName[1];
    if (prev && lvl > prev + 1) out.headings.push({ from: prev, to: lvl, text: h.textContent.trim().slice(0, 40) });
    prev = lvl;
  }
  return out;
}

/** Reports are read by people. One defect in a shared footer is one line, not 120. */
function summarise(raw) {
  const groups = new Map();
  for (const { key, severity, title, detail, where } of raw) {
    const g = groups.get(key) ?? { severity, title, detail, where: [] };
    g.where.push(where);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const n = g.where.length;
    const shown = g.where.slice(0, 4).join(", ");
    const more = n > 4 ? `, +${n - 4} more` : "";
    return finding(
      g.severity,
      n === 1 ? g.title : `${g.title} — on ${n} page/width combinations`,
      [g.detail, `Seen at: ${shown}${more}`].filter(Boolean).join("\n"),
    );
  });
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

/** True when `next build` has already produced something `next start` can serve. */
export function buildPresent() {
  return fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
}

/// Starts `next start` against the build the level-2 build check produced, so a level-3
/// run covers accessibility without anyone remembering to export QA_BASE_URL first. A
/// check that only runs when a human sets an environment variable is a check that never
/// runs; Ariel asked for coverage, not for an opt-in.
async function withServer(fn) {
  if (process.env.QA_BASE_URL) return fn(process.env.QA_BASE_URL.replace(/\/$/, ""));

  const port = await freePort();
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    if (!(await awaitServer(`${base}/he`, 90_000))) {
      return [finding("minor", "Accessibility skipped — the local server never came up", `Waited 90s for ${base}.`)];
    }
    return await fn(base);
  } finally {
    child.kill("SIGTERM");
  }
}

export async function accessibility({ baseUrl } = {}) {
  if (baseUrl) return audit(baseUrl.replace(/\/$/, ""));
  return withServer(audit);
}

async function audit(base) {
  const { chromium } = await import("playwright");
  const exe = process.env.PLAYWRIGHT_CHROMIUM;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const raw = [];
  const push = (key, severity, title, detail, where) => raw.push({ key, severity, title, detail, where });

  try {
    for (const locale of LOCALES) {
      for (const p of PATHS) {
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          const where = `${locale}${p || "/"} @${width}`;
          const route = `${locale}${p || "/"}`;
          try {
            const res = await page.goto(`${base}/${locale}${p}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
            if (res && res.status() >= 400) {
              push(`status:${route}:${res.status()}`, "blocker", `${route} returned ${res.status()}`, "", where);
              continue;
            }
            await page.waitForTimeout(350);
            const r = await page.evaluate(auditPage);

            // No h1 usually means the page threw and rendered nothing — worth saying
            // so plainly rather than reporting it as a heading nit. This is the check
            // that caught a missing "use client" boundary that typecheck and lint
            // both passed.
            if (r.h1 === 0)
              push(`h1-0:${route}`, "blocker", `${route} has no h1`, "Often a server error rendering an empty document.", where);
            else if (r.h1 > 1) push(`h1-many:${route}`, "major", `${route} has ${r.h1} h1 elements`, "", where);
            if (r.overflow) push(`overflow:${route}`, "major", `${route} scrolls horizontally`, "", where);
            for (const c of r.contrast) {
              push(
                `contrast:${c.colour}:${c.size}:${c.text}`,
                "major",
                `Contrast ${c.got}:1 (needs ${c.need})`,
                `${c.colour} at ${c.size}px — "${c.text}"`,
                where,
              );
            }
            for (const h of r.headings) push(`skip:${route}:${h.from}-${h.to}`, "minor", `${route} heading skips h${h.from} to h${h.to}`, h.text, where);
            for (const f of r.fields) push(`field:${route}:${f}`, "major", `Unlabelled field "${f}" on ${route}`, "", where);
            for (const t of r.targets) push(`target:${t.text}:${t.w}x${t.h}`, "minor", `Target ${t.w}x${t.h} below the 24x24 floor (SC 2.5.8)`, t.text, where);
          } finally {
            await page.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  return summarise(raw);
}
