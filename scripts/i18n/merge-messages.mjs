#!/usr/bin/env node
// ADR 0006: merge a fragment of messages into messages/he.json and
// messages/en.json.
//
//   node scripts/i18n/merge-messages.mjs <fragment.he.json> <fragment.en.json>
//
// A fragment is a nested object of new keys. A key that already exists is
// an error, never an overwrite: two pieces of work naming the same key
// differently is a conflict a person should see. Writes are serialised
// with a lock directory, so several runs at once cannot lose each other's
// keys. Formatting matches the files (two spaces, a trailing newline).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const [heFrag, enFrag] = process.argv.slice(2);
if (!heFrag || !enFrag) {
  console.error("usage: merge-messages.mjs <fragment.he.json> <fragment.en.json>");
  process.exit(2);
}

const lock = path.join(ROOT, "messages", ".merge-lock");
const started = Date.now();
for (;;) {
  try {
    fs.mkdirSync(lock);
    break;
  } catch {
    if (Date.now() - started > 30_000) {
      console.error("messages are locked by another merge for 30s; giving up");
      process.exit(1);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function merge(target, source, at) {
  for (const [key, value] of Object.entries(source)) {
    const here = at ? `${at}.${key}` : key;
    if (value && typeof value === "object") {
      if (key in target && (typeof target[key] !== "object" || target[key] === null)) throw new Error(`${here} is a message, not a group`);
      target[key] ??= {};
      merge(target[key], value, here);
    } else {
      if (key in target) throw new Error(`${here} already exists`);
      if (typeof value !== "string" || !value.trim()) throw new Error(`${here} must be a non-empty string`);
      target[key] = value;
    }
  }
}

try {
  // Both are merged in memory before either is written, so a fragment that
  // fails in one language leaves both files as they were.
  const out = [
    ["he.json", heFrag],
    ["en.json", enFrag],
  ].map(([file, frag]) => {
    const p = path.join(ROOT, "messages", file);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    merge(data, JSON.parse(fs.readFileSync(frag, "utf8")), "");
    return [p, data];
  });
  for (const [p, data] of out) fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  console.log("merged");
} catch (err) {
  console.error(String(err.message ?? err));
  process.exitCode = 1;
} finally {
  fs.rmdirSync(lock);
}
