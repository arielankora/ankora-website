#!/usr/bin/env node
// Mint a personal token for the blog agent (lib/blog-agent-auth.ts).
//
//   node scripts/blog-agent-token.mjs ariel draft ~/Sites/.blog_agent_token
//
// Writes the token to <file> with mode 600 and prints ONLY the line to add
// to BLOG_AGENT_TOKENS in Vercel. The token itself is never printed, so it
// never lands in a terminal scrollback, a chat or a log.
//
// Refuses to overwrite an existing file: rotating is deliberate. Move the old
// file aside first, then replace that person's entry in Vercel.
import crypto from "node:crypto";
import fs from "node:fs";

const [person, scope, file] = process.argv.slice(2);
if (!person || !["draft", "publish"].includes(scope) || !file) {
  console.error("usage: node scripts/blog-agent-token.mjs <ariel|hadas> <draft|publish> <file>");
  process.exit(1);
}
if (fs.existsSync(file)) {
  console.error(`${file} already exists. Not overwriting a token.`);
  process.exit(1);
}

const token = `ankb_${crypto.randomBytes(32).toString("base64url")}`;
fs.writeFileSync(file, token, { mode: 0o600 });
const hash = crypto.createHash("sha256").update(token, "utf8").digest("hex");
console.log(`${person}:${scope}:${hash}`);
