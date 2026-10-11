#!/usr/bin/env node
// Check a post bundle against tools/blog-agent/style-guide.md before it is saved.
//
//   node tools/blog-agent/check-post.mjs <bundleDir>
//
// Prints one line per finding and exits 1 when there is any error.
// Errors stop the save. Warnings are reported to the person and the save goes on.
// No dependencies, so it runs anywhere Node 18+ does.
import fs from "node:fs";
import path from "node:path";

const CATEGORIES = [
  "personal-operations",
  "household-property",
  "vendors-services",
  "travel-logistics",
  "business-operations",
  "company-insights",
];
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Positioning words Ankora never uses about itself (style guide, section 6).
// A comparison post may name them to draw the line; it says so with
// "allowComparisonTerms": true in post.json.
const BANNED = [
  /קונסיירז/,
  /concierge/i,
  /עוזר(?:ת|\/ת)? אישי(?:ת|\/ת)?/,
  /personal assistant/i,
  /virtual assistant/i,
  /executive assistant/i,
  /lifestyle/i,
  /ניקיון/,
];
// Hype, never allowed.
const HYPE = [/מהפכני/, /פורץ דרך/, /game[- ]changer/i, /revolutionary/i, /\bperfect solution\b/i, /פתרון מושלם/];
const DASH = /[\u2013\u2014]/;
const EMOJI = /\p{Extended_Pictographic}/u;

const findings = [];
const err = (where, msg) => findings.push({ level: "error", where, msg });
const warn = (where, msg) => findings.push({ level: "warning", where, msg });

// Text with markdown link targets removed, so /personal-assistant-for-executives
// in a URL is not read as the words.
const prose = (s) => String(s || "").replace(/\]\([^)]*\)/g, "]");
const words = (s) => prose(s).replace(/[#>*_`\-[\]()]/g, " ").split(/\s+/).filter(Boolean).length;

// A Hebrew paragraph whose first letter is Latin ("AI טוב ב...") is laid out
// left to right by most renderers: Markdown previews, LinkedIn, email. The
// text reads scrambled. Every Hebrew line has to open with a Hebrew word.
const LEADING_MARKUP = /^[\s#>*_\-[(\d.)]+/;
function latinFirstLines(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.replace(LEADING_MARKUP, ""))
    .filter((l) => /^[A-Za-z]/.test(l));
}

function checkLocale(locale, p, allowComparison) {
  const at = (field) => `${locale}.${field}`;
  if (!p.title) err(at("title"), "missing");
  else if (p.title.length > 70) warn(at("title"), `${p.title.length} characters, aim for 70 or fewer`);
  if (/!/.test(p.title || "")) err(at("title"), "no exclamation marks");

  if (!SAFE_SLUG.test(p.slug || "") || (p.slug || "").length > 120) err(at("slug"), "must be lowercase Latin words joined by hyphens");
  else {
    const n = p.slug.split("-").length;
    if (n < 3 || n > 6) warn(at("slug"), `${n} words, aim for 3 to 6`);
  }

  if (!p.excerpt) err(at("excerpt"), "missing");
  else if (p.excerpt.length > 155) err(at("excerpt"), `${p.excerpt.length} characters, the limit is 155`);
  if (/!/.test(p.excerpt || "")) err(at("excerpt"), "no exclamation marks");

  if (!CATEGORIES.includes(p.category)) err(at("category"), `must be one of ${CATEGORIES.join(", ")}`);
  const tags = Array.isArray(p.tags) ? p.tags : [];
  if (tags.length < 4 || tags.length > 8) warn(at("tags"), `${tags.length} tags, aim for 4 to 8`);

  const body = String(p.content || "");
  if (/^#\s/m.test(body)) err(at("content"), "no H1 in the body, the title is the H1");
  if (/<\/?[A-Za-z][^>]*>/.test(body)) err(at("content"), "plain Markdown only, no HTML or JSX");
  const n = words(body);
  if (n < 900 || n > 1600) warn(at("content"), `${n} words, aim for 900 to 1,600`);

  const firstPara = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#")) || "";
  const fp = words(firstPara);
  if (fp < 30 || fp > 70) warn(at("content"), `opening paragraph is ${fp} words, the "in short" answer should be 40 to 60`);

  const h2 = body.match(/^##\s.+$/gm) || [];
  const questions = h2.filter((h) => /\?\s*$/.test(h)).length;
  if (h2.length && questions * 2 < h2.length) warn(at("content"), `${questions} of ${h2.length} H2 headings are questions, aim for at least half`);

  const internal = (body.match(/\]\((?:\/|https:\/\/(?:www\.)?ankora\.co\.il)/g) || []).length;
  if (internal < 2) warn(at("content"), `${internal} internal links, aim for 2 to 4`);
  const external = (body.match(/\]\(https?:\/\/(?!(?:www\.)?ankora\.co\.il)/g) || []).length;
  if (external === 0 && /\d/.test(body)) warn(at("content"), "numbers but no external source link");
  if (/!\[\s*\]/.test(body)) err(at("content"), "every image needs alt text");
  if ((prose(body).match(/!(?!\[)/g) || []).length) warn(at("content"), "exclamation marks in the body");

  const faq = Array.isArray(p.faq) ? p.faq : [];
  if (locale === "he") {
    const bad = [p.title, p.excerpt, body, ...faq.flatMap((f) => [f?.q, f?.a])].flatMap(latinFirstLines);
    for (const l of bad) err(at("rtl"), `starts with a Latin word, so it renders left to right: "${l.slice(0, 40)}..."`);
  }
  if (faq.length < 3) err(at("faq"), `${faq.length} items, at least 3`);
  if (faq.length > 5) warn(at("faq"), `${faq.length} items, aim for 3 to 5`);
  faq.forEach((f, i) => {
    if (!f || !f.q || !f.a) return err(at(`faq[${i}]`), "needs both q and a");
    const w = words(f.a);
    if (w < 25 || w > 100) warn(at(`faq[${i}]`), `answer is ${w} words, aim for 40 to 80`);
  });

  // Text-wide rules, on everything a reader sees.
  const all = [p.title, p.excerpt, body, ...faq.flatMap((f) => [f?.q, f?.a]), ...(tags || [])].map(prose).join("\n");
  if (DASH.test(all)) err(at("*"), "em dash or en dash used as a separator; use a comma, a colon or a new sentence");
  if (EMOJI.test(all)) err(at("*"), "no emoji");
  for (const re of HYPE) if (re.test(all)) err(at("*"), `hype word: ${all.match(re)[0]}`);
  if (!allowComparison) for (const re of BANNED) if (re.test(all)) err(at("*"), `positioning word Ankora does not use: ${all.match(re)[0]}`);
}

function checkLinkedIn(locale, text) {
  if (!text) return;
  const at = `linkedin.${locale}`;
  if (DASH.test(text)) err(at, "em dash or en dash");
  if (locale === "he") for (const l of latinFirstLines(text)) err(at, `line starts with a Latin word: "${l.slice(0, 40)}..."`);
  if ((text.match(/\p{Extended_Pictographic}/gu) || []).length > 1) err(at, "at most one emoji");
  if (/!/.test(text)) warn(at, "exclamation marks");
  if (text.length < 700 || text.length > 1500) warn(at, `${text.length} characters, aim for 700 to 1,300`);
  const hook = text.split("\n").filter(Boolean).slice(0, 2).join(" ");
  if (hook.length > 210) warn(at, "the opening runs past the 'see more' cut, about 210 characters");
  for (const re of HYPE) if (re.test(text)) err(at, `hype word: ${text.match(re)[0]}`);
}

const bundle = path.resolve(process.argv[2] || "");
const post = JSON.parse(fs.readFileSync(path.join(bundle, "post.json"), "utf8"));
if (!post.he) err("he", "the Hebrew post is required");
for (const locale of ["he", "en"]) if (post[locale]) checkLocale(locale, post[locale], !!post.allowComparisonTerms);
if (post.he && post.en && post.he.slug === post.en.slug) warn("slug", "same slug in both languages is fine, but check it reads naturally in English");
checkLinkedIn("he", post.linkedin?.he);
checkLinkedIn("en", post.linkedin?.en);

for (const f of findings) console.log(`${f.level === "error" ? "ERROR" : "warn "}  ${f.where}: ${f.msg}`);
const errors = findings.filter((f) => f.level === "error").length;
console.log(errors ? `\n${errors} error(s). Fix before saving.` : `\nOK. ${findings.length} warning(s).`);
process.exit(errors ? 1 : 0);
