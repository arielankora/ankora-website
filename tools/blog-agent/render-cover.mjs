#!/usr/bin/env node
// Render the covers for one post bundle.
//
//   node tools/blog-agent/render-cover.mjs <bundleDir>            options + preview
//   node tools/blog-agent/render-cover.mjs <bundleDir> --pick N   the chosen cover
//
// post.json carries the options Claude designed for this post (2 or 3), each a
// concept from cover-template.html with its content per locale:
//
//   "cover": { "options": [
//     { "concept": "cards", "he": { "items": [["...", ""]], "held": 4 }, "en": { ... } },
//     { "concept": "line",  "he": { "line": "...|...", "sub": "..." }, "en": { ... } }
//   ] }
//
// Without --pick it writes option-1-he.png ... and preview.png: every option
// full size, and below them each one as the blog list shows it, cropped to
// 16:10 on the site's dark background. That is what the runner chooses from.
//
// With --pick N it writes cover-he.png and cover-en.png from option N, and
// the LinkedIn image (template C): linkedin-he.png, plus linkedin-en.png when
// "linkedinEnglish": true. It records the choice as cover.chosen.
//
// Needs Playwright and a Chromium. In the Claude cloud workspace Chromium is
// at /opt/pw-browsers/chromium; elsewhere Playwright's own browser is used.
// Run from a checkout of the repo: the template loads the site's own fonts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const bundle = path.resolve(args.find((a) => !a.startsWith("--")) || "");
const pickAt = args.indexOf("--pick");
const pick = pickAt >= 0 ? Number(args[pickAt + 1]) : null;
const postPath = path.join(bundle, "post.json");
const post = JSON.parse(fs.readFileSync(postPath, "utf8"));
const options = post.cover?.options || [];
if (!options.length) {
  console.error('post.json has no cover.options. Design 2 or 3 options first (style guide, section 11).');
  process.exit(2);
}
if (pick != null && !(pick >= 1 && pick <= options.length)) {
  console.error(`--pick must be 1 to ${options.length}`);
  process.exit(2);
}

const label = (category) => String(category || "company-insights").replace(/-/g, " ").toUpperCase();
const locales = ["he", "en"].filter((l) => post[l]);
const job = (opt, locale, out) => ({
  ...opt[locale],
  concept: opt.concept,
  seed: post[locale].slug,
  locale,
  title: post[locale].title,
  category: label(post[locale].category),
  out,
});

const jobs = [];
if (pick == null) {
  options.forEach((opt, i) => locales.forEach((l) => opt[l] && jobs.push(job(opt, l, `option-${i + 1}-${l}.png`))));
} else {
  const opt = options[pick - 1];
  for (const l of locales) jobs.push(job(opt, l, `cover-${l}.png`));
  const li = (l) => ({ concept: "C", seed: post[l].slug, locale: l, title: post[l].title, category: label(post[l].category), out: `linkedin-${l}.png` });
  jobs.push(li("he"));
  if (post.linkedinEnglish && post.en) jobs.push(li("en"));
}

const { chromium } = await import("playwright");
const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 840 } });
const template = pathToFileURL(path.join(here, "cover-template.html")).href;

for (const j of jobs) {
  // A new query string per job: a hash change would not reload the page.
  await page.goto(`${template}?q=${encodeURIComponent(JSON.stringify(j))}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.locator("#c").screenshot({ path: path.join(bundle, j.out) });
  console.log(j.out);
}

if (pick == null) {
  // The preview: what the runner chooses from. Hebrew options, as on the site.
  const files = options.map((_, i) => `option-${i + 1}-he.png`);
  const src = (f) => "data:image/png;base64," + fs.readFileSync(path.join(bundle, f)).toString("base64");
  const html = `<body style="margin:0;background:#0B1B33;font:600 22px system-ui;color:#F4EDE1">
<div id="p" style="padding:28px;width:${files.length * 520}px">
<div style="display:flex;gap:28px">${files.map((f, i) => `<div><div style="margin:0 0 10px">${i + 1}</div><img src="${src(f)}" style="width:492px;display:block"></div>`).join("")}</div>
<div style="margin:34px 0 10px;font-weight:400;color:#A9B8C9">As the blog list shows them (16:10, dark background)</div>
<div style="display:flex;gap:28px">${files.map((f) => `<div style="width:300px;aspect-ratio:16/10;overflow:hidden;outline:1px solid rgba(243,234,219,.11);margin-inline-end:192px"><img src="${src(f)}" style="width:100%;height:100%;object-fit:cover"></div>`).join("")}</div>
</div></body>`;
  await page.setViewportSize({ width: files.length * 520 + 56, height: 900 });
  await page.setContent(html);
  await page.locator("#p").screenshot({ path: path.join(bundle, "preview.png") });
  console.log("preview.png");
} else {
  post.cover.chosen = pick;
  fs.writeFileSync(postPath, JSON.stringify(post, null, 2));
}
await browser.close();
