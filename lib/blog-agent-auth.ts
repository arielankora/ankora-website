import crypto from "crypto";
import { FOUNDERS } from "@/lib/founders";
import { isRequestAuthorized } from "@/lib/adminAuth";
import { rateLimitResponse } from "@/lib/rate-limit";
import type { Locale } from "@/content";

// The blog agent (a Claude skill run by Ariel or Hadas) writes posts through
// the same admin routes the editor uses. It cannot use the admin password:
// one shared secret on several laptops cannot be revoked for one person, does
// not say who wrote a post, and opens the whole admin rather than the posts.
//
// Instead each person gets their own bearer token, kept once on their own
// computer (~/Sites/.blog_agent_token, mode 600). The server stores only a
// SHA-256 of it, in BLOG_AGENT_TOKENS:
//
//   BLOG_AGENT_TOKENS="ariel:draft:<sha256hex>,hadas:draft:<sha256hex>"
//
// - person: the founder's English first name, lower case. It decides the
//   author on every post the token writes, in both languages, so the post's
//   schema carries the founder's Person node and LinkedIn.
// - scope: "draft" saves drafts only and cannot touch a live post.
//   "publish" may also publish. Moving to direct publishing is a change to
//   this one word, never to the skill.
//
// Revoking a person is deleting their entry. Nobody else is affected.
// scripts/blog-agent-token.mjs mints a token without ever printing it.

export type BlogAgentScope = "draft" | "publish";

export type BlogWriter =
  | { kind: "admin" }
  | { kind: "agent"; person: string; scope: BlogAgentScope; author: Record<Locale, string> };

type Entry = { person: string; scope: BlogAgentScope; hash: Buffer };

const HEX_SHA256 = /^[a-f0-9]{64}$/;

function founderFor(person: string) {
  return FOUNDERS.find((f) => f.name.en.split(" ")[0].toLowerCase() === person);
}

/** Entries that are malformed or name nobody are dropped, never half-trusted. */
export function parseAgentTokens(raw: string | undefined): Entry[] {
  if (!raw) return [];
  const out: Entry[] = [];
  for (const part of raw.split(",")) {
    const [person, scope, hash] = part.trim().split(":");
    if (!person || !hash || !HEX_SHA256.test(hash)) continue;
    if (scope !== "draft" && scope !== "publish") continue;
    if (!founderFor(person)) continue;
    out.push({ person, scope, hash: Buffer.from(hash, "hex") });
  }
  return out;
}

export function hashAgentToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function bearer(headers: Headers): string | null {
  const value = headers.get("authorization");
  if (!value || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  // Real tokens are 48 characters. The bounds only keep junk from being hashed.
  return token.length >= 32 && token.length <= 200 ? token : null;
}

/** Pure: who this bearer token belongs to, or null. */
export function agentForToken(token: string, raw: string | undefined): BlogWriter | null {
  const digest = crypto.createHash("sha256").update(token, "utf8").digest();
  let match: Entry | null = null;
  // Compare against every entry, so timing says nothing about which one matched.
  for (const entry of parseAgentTokens(raw)) {
    if (crypto.timingSafeEqual(digest, entry.hash) && !match) match = entry;
  }
  if (!match) return null;
  const founder = founderFor(match.person)!;
  return { kind: "agent", person: match.person, scope: match.scope, author: { ...founder.name } };
}

export function hasBearer(headers: Headers): boolean {
  return headers.get("authorization") !== null;
}

// A wrong token is a guess. 30 per IP per 15 minutes is far beyond what one
// person running a skill sends, and makes guessing a 288-bit token moot anyway.
const AGENT_ATTEMPT_LIMIT = 30;
const AGENT_WINDOW_MS = 15 * 60 * 1000;

/**
 * The admin session cookie, or an agent's bearer token. Returns the writer,
 * or a Response to send back as is.
 */
export async function resolveBlogWriter(request: Request): Promise<BlogWriter | Response> {
  if (hasBearer(request.headers)) {
    const limited = await rateLimitResponse(request.headers, "blog-agent", AGENT_ATTEMPT_LIMIT, AGENT_WINDOW_MS);
    if (limited) return limited;
    const token = bearer(request.headers);
    const writer = token ? agentForToken(token, process.env.BLOG_AGENT_TOKENS) : null;
    if (writer) return writer;
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isRequestAuthorized()) return { kind: "admin" };
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * What an agent may not do. Admin is never refused here.
 * `requestedDraft` is what the write asks for; `existingDraft` is the post
 * on disk before the write (undefined when creating).
 */
export function agentWriteRefusal(
  writer: BlogWriter,
  { requestedDraft, existingDraft }: { requestedDraft: boolean; existingDraft?: boolean }
): string | null {
  if (writer.kind === "admin" || writer.scope === "publish") return null;
  if (existingDraft === false) return "This token cannot change a published post.";
  if (!requestedDraft) return "This token may only save drafts. Publish from the admin.";
  return null;
}

/** The author an agent's post carries is the token's owner, always. */
export function authorFor(writer: BlogWriter, locale: Locale, requested: string): string {
  return writer.kind === "agent" ? writer.author[locale] : requested;
}
