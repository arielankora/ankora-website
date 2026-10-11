#!/usr/bin/env node
// Render the covers for one post bundle.
//
//   node tools/blog-agent/render-cover.mjs <bundleDir>
//
// Reads <bundleDir>/post.json and writes, next to it:
//   cover-he.png, cover-en.png        site hero, template A (no title)
//   linkedin-he.png [, linkedin-en.png] share image, template C (title)
// linkedin-en.png only when post.json has "linkedinEnglish": true.
//
// Needs Playwright and a Chromium. In the Claude cloud workspace Chromium is
// at /opt/pw-browsers/chromium; elsewhere Playwright's own browser is used.
// Run from a checkout of the repo: the template loads the site's own fonts
// from public/fonts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(process.argv[2] || "");
const post = JSON.parse(fs.readFileSync(path.join(bundle, "post.json"), "utf8"));

const label = (category) => String(category || "company-insights").replace(/-/g, " ").toUpperCase();

const jobs = [];
for (const locale of ["he", "en"]) {
  const p = post[locale];
  if (!p) continue;
  jobs.push({ concept: "A", seed: p.slug, locale, title: p.title, category: label(p.category), out: `cover-${locale}.png` });
}
jobs.push({ concept: "C", seed: post.he.slug, locale: "he", title: post.he.title, category: label(post.he.category), out: "linkedin-he.png" });
if (post.linkedinEnglish && post.en) {
  jobs.push({ concept: "C", seed: post.en.slug, locale: "en", title: post.en.title, category: label(post.en.category), out: "linkedin-en.png" });
}

const { chromium } = await import("playwright");
const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 840 } });
const template = pathToFileURL(path.join(here, "cover-template.html")).href;

for (const job of jobs) {
  // A new query string per job: a hash change would not reload the page.
  await page.goto(`${template}?q=${encodeURIComponent(JSON.stringify(job))}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.locator("#c").screenshot({ path: path.join(bundle, job.out) });
  console.log(job.out);
}
await browser.close();
