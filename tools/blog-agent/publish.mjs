#!/usr/bin/env node
// Save a post bundle to the blog, as drafts, with the runner's own token.
//
//   node publish.mjs <bundleDir> [--publish]
//
// Runs on the person's own computer, where their token lives. It is copied
// into the bundle by the skill, so it needs nothing but Node 18+.
//
// The token is read from the first of:
//   $BLOG_AGENT_TOKEN_FILE
//   ~/mnt/*/.blog_agent_token     (a folder connected to Claude)
//   ~/Sites/.blog_agent_token
// It is sent only to www.ankora.co.il and never printed.
//
// What it does, in order: upload each cover, create the Hebrew post, create
// the English post naming the Hebrew one in translationOf. Progress is kept
// in <bundleDir>/state.json, so a second run after a failure continues where
// the first stopped instead of writing anything twice.
//
// --publish asks the server to publish instead of saving drafts. A token
// with the "draft" scope is refused (403); that is the switch to flip once
// five posts in a row went out without a substantive fix.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node 22.21+).
// The shell Claude runs on a person's computer reaches the internet only
// through such a proxy, so without this every request fails with a bare
// "fetch failed" (found on the first real run, 11.10.2026). Re-run this same
// script once with the flag set, rather than asking anyone to remember it.
const proxied = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxied && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(r.status ?? 1);
}

const BASE = "https://www.ankora.co.il";
const args = process.argv.slice(2);
const bundle = path.resolve(args.find((a) => !a.startsWith("--")) || "");
const publish = args.includes("--publish");

function tokenFile() {
  if (process.env.BLOG_AGENT_TOKEN_FILE) return process.env.BLOG_AGENT_TOKEN_FILE;
  const mnt = path.join(os.homedir(), "mnt");
  if (fs.existsSync(mnt)) {
    for (const d of fs.readdirSync(mnt)) {
      const f = path.join(mnt, d, ".blog_agent_token");
      if (fs.existsSync(f)) return f;
    }
  }
  return path.join(os.homedir(), "Sites", ".blog_agent_token");
}

const file = tokenFile();
if (!fs.existsSync(file)) {
  console.error(`No token found (looked for ${file}). Ask Ariel to set one up for you.`);
  process.exit(2);
}
const token = fs.readFileSync(file, "utf8").trim();
const post = JSON.parse(fs.readFileSync(path.join(bundle, "post.json"), "utf8"));
const statePath = path.join(bundle, "state.json");
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

async function call(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${json.error || ""}`.trim());
  return json;
}

async function uploadCover(locale) {
  const key = `cover_${locale}`;
  if (state[key]) return state[key];
  const f = path.join(bundle, `cover-${locale}.png`);
  if (!fs.existsSync(f)) return null;
  const { url } = await call("POST", "/api/admin/upload-image", {
    slug: post[locale].slug,
    contentType: "image/png",
    dataBase64: fs.readFileSync(f).toString("base64"),
  });
  state[key] = url;
  save();
  return url;
}

async function savePost(locale, translationOf) {
  const key = `post_${locale}`;
  const p = post[locale];
  const payload = {
    locale,
    title: p.title,
    slug: p.slug,
    excerpt: p.excerpt,
    category: p.category,
    tags: p.tags,
    content: p.content,
    faq: p.faq,
    coverImage: state[`cover_${locale}`] || null,
    coverImagePosition: "center",
    publishedAt: p.publishedAt || new Date().toISOString().slice(0, 10),
    draft: !publish,
    ...(translationOf ? { translationOf } : {}),
  };
  if (state[key]) {
    // Already created. The server only sees it after the deploy its commit
    // triggered, so an update can 404 for about a minute.
    await call("PUT", `/api/admin/posts/${locale}/${p.slug}`, payload);
    console.log(`updated ${locale}/${p.slug}`);
  } else {
    await call("POST", "/api/admin/posts", payload);
    state[key] = p.slug;
    save();
    console.log(`created ${locale}/${p.slug}`);
  }
}

try {
  await uploadCover("he");
  await savePost("he", post.en ? post.en.slug : null);
  if (post.en) {
    await uploadCover("en");
    await savePost("en", post.he.slug);
  }
  console.log("\nAdmin (visible after the deploy, about 1 to 2 minutes):");
  for (const locale of ["he", "en"]) {
    if (post[locale]) console.log(`  ${BASE}/he/admin/posts/edit?locale=${locale}&slug=${post[locale].slug}`);
  }
} catch (e) {
  console.error(String(e.message || e));
  console.error("Nothing was written twice. Fix the cause and run again; state.json remembers what is done.");
  process.exit(1);
}
