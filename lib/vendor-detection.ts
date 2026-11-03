/// P8 (הוספת תת-מעבד חדש), 3.11.2026: noticing that a task connects a
/// new vendor to the product, so the subprocessor run is not left to
/// someone's memory. The stranger test on P8 found exactly that gap: in
/// Unipile the vendor was connected before the process started.
///
/// Pure on purpose: it reads text and a list of names, nothing else, so
/// the unit suite can pin every case without a database. The domain layer
/// (lib/app-domain/vendor-detections.ts) decides which tasks are in scope
/// and what to record.
///
/// Scope, as Ariel set it: only the app and the service Ankora gives its
/// clients, and the client data that passes through them. Not Ankora's
/// own back office, and not marketing or sales. That scope is applied by
/// the caller (which tasks are read); this file only answers "does this
/// text look like connecting a vendor, and which one".
///
/// The detector is deliberately a suggestion, never a verdict: what it
/// finds is put to a person (or to Claude, who asks one) before any run
/// opens. A false alarm costs one question; a miss is what the annual
/// vendor review in January is there to catch.

import security from "@/content/security/he";

/// Words that say "we are connecting something". Hebrew forms cover the
/// verb, the noun and the common prefixes (ל, ה, ו, ב, ש).
const HEBREW_ACTIONS = [
  "לחבר",
  "חיבור",
  "מחבר",
  "מחברים",
  "התחברות",
  "אינטגרציה",
  "אינטגרציית",
  "להירשם",
  "הרשמה",
  "להטמיע",
  "הטמעת",
];
const LATIN_ACTIONS = [
  "connect",
  "connector",
  "connection",
  "integrate",
  "integration",
  "mcp",
  "api",
  "sdk",
  "oauth",
  "webhook",
  "webhooks",
  "signup",
  "sign up",
];

/// Latin words that sit next to an action word but are never a vendor:
/// the technology itself, our own names, and generic nouns.
const NOT_A_VENDOR = new Set(
  [
    "mcp",
    "api",
    "apis",
    "sdk",
    "oauth",
    "webhook",
    "webhooks",
    "server",
    "client",
    "connector",
    "connection",
    "integration",
    "key",
    "token",
    "rest",
    "graphql",
    "json",
    "http",
    "https",
    "url",
    "app",
    "ankora",
    "claude",
    "the",
    "a",
    "an",
    "to",
    "with",
    "via",
    "new",
    "v1",
    "v2",
    "pdf",
    "csv",
    "ui",
    "qa",
    "pr",
    "dpa",
    "soc",
    "iso",
    "p8",
  ].map((w) => w.toLowerCase())
);

/// Hebrew action words that ask about a vendor even with no name next to
/// them: the verb of connecting itself ("לחבר את המערכת של הבנק"). The
/// nouns ("אינטגרציה", "התחברות", "הרשמה") are too common in product
/// writing to ask about alone (3.11.2026: "בדיקות אינטגרציה" asked).
const HEBREW_BARE_ACTIONS = new Set(["לחבר", "חיבור", "מחברים", "להירשם", "להטמיע"]);

/// Hebrew phrases where an action word does not mean connecting anything:
/// a kind of test, not an integration.
const HEBREW_NOT_CONNECTING = /(?:בדיקות|בדיקת|טסטים של|טסט)\s+(?:יחידה,?\s+)?אינטגרציה/gu;

/// Common words of product and engineering writing, never a vendor's name
/// (3.11.2026: "tests" from a path, and the like). Lower case.
const COMMON_WORDS = new Set([
  "test", "tests", "spec", "specs", "unit", "e2e", "schema", "migration", "migrations", "branch", "commit", "merge",
  "deploy", "build", "code", "file", "files", "field", "fields", "screen", "step", "steps", "flow", "prompt", "plan",
  "task", "tasks", "status", "error", "errors", "bug", "fix", "data", "database", "table", "tables", "user", "users",
  "admin", "client", "clients", "portal", "script", "cron", "job", "jobs", "check", "checks", "lint", "type", "types", "model", "models",
  "proposal", "proposals", "approval", "approvals", "knowledge", "vendor", "vendors", "detection", "run", "runs",
  "crm", "erp", "saas", "ai", "llm", "main", "preview", "production", "staging", "local", "null", "true", "false",
  "string", "number", "id", "ids", "next", "result", "results", "payload", "tool", "tools", "description", "workflow",
]);

/// A process, source or rule code (P14, S30, R3): ours, not a vendor.
const OUR_CODE = /^[A-Z]{1,2}\d+$/;

/// What is code, not prose: inline code, URLs, paths, and identifiers
/// (camelCase, snake_case, file.ext). Removed before reading, so a path
/// like tests/integration/x.test.ts says neither "integration" nor "tests".
function withoutCode(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S*\/\S*/g, " ")
    .replace(/\b\w+(?:\.\w+)*\.[a-z]+[A-Z]\w*\b/g, " ")
    .replace(/\b[a-z]+[A-Z]\w*\b/g, " ")
    .replace(/\b\w+_\w+\b/g, " ")
    .replace(/\b[\w-]+\.(?:ts|tsx|js|mjs|json|md|sql|prisma|yml|yaml|css|html)\b/g, " ");
}

/// Sentences: a vendor counts only in the sentence that says "connect".
/// A dot inside a name (cal.com) does not end one.
function sentencesOf(text: string): string[] {
  return text.split(/\n+|[.!?;](?=\s|$)/u).map((x) => x.trim()).filter(Boolean);
}

/// A channel name that belongs to a vendor we already work with. Seeing
/// one is a new channel at an existing vendor (Ariel, 3.11.2026): a note
/// on that vendor's run, not a new run.
export const CHANNEL_VENDOR: Record<string, string> = {
  whatsapp: "Unipile",
  "וואטסאפ": "Unipile",
  "ווטסאפ": "Unipile",
  linkedin: "Unipile",
  "לינקדאין": "Unipile",
  instagram: "Unipile",
  telegram: "Unipile",
  gmail: "Google Workspace",
  "google drive": "Google Workspace",
  drive: "Google Workspace",
  "google docs": "Google Workspace",
  "google calendar": "Google Workspace",
  neon: "Neon",
  postgres: "Neon",
  upstash: "Upstash",
  redis: "Upstash",
  vercel: "Vercel",
  fireflies: "Fireflies",
  resend: "Resend",
  anthropic: "Anthropic",
  openai: "OpenAI",
  "chatgpt": "OpenAI",
};

/// The subprocessors the security page already names: the product's
/// register of known vendors. Read from the page itself, so adding a row
/// there is the one place a vendor becomes "known".
export function knownVendorsFromSite(): string[] {
  return security.vendors.rows.map((r) => r.name);
}

export function vendorKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type VendorSignal = {
  /// The vendor's name as written, or null when an action word was found
  /// but no name next to it ("לחבר את המערכת של הבנק").
  vendor: string | null;
  /// The existing vendor this is a new channel of, when it is one.
  existingVendor: string | null;
  /// What set it off, for the person who is asked: "לחבר + Pipedrive".
  matched: string;
};

const HEBREW_PREFIX = "[להובשמכ]{0,2}";
const hebrewActionRe = new RegExp(
  `(?:^|[^\\u0590-\\u05FF])${HEBREW_PREFIX}(${HEBREW_ACTIONS.join("|")})(?=$|[^\\u0590-\\u05FF])`,
  "u"
);
const latinActionRe = new RegExp(`\\b(${LATIN_ACTIONS.map((a) => a.replace(" ", "\\s+")).join("|")})\\b`, "i");

/// Latin tokens, with a dot or dash inside allowed (Meet-Alfred, cal.com),
/// and two capitalised words kept together (Google Drive, Meet Alfred).
const latinTokenRe = /[A-Za-z][A-Za-z0-9.\-]*[A-Za-z0-9]|[A-Za-z]/g;

function latinTokens(text: string): { word: string; index: number }[] {
  const out: { word: string; index: number }[] = [];
  for (const m of text.matchAll(latinTokenRe)) out.push({ word: m[0], index: m.index ?? 0 });
  return out;
}

function channelVendorOf(text: string): { channel: string; vendor: string } | null {
  const lower = text.toLowerCase();
  // Longest names first, so "google drive" wins over "drive".
  const names = Object.keys(CHANNEL_VENDOR).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const isHebrew = /[֐-׿]/.test(name);
    const re = isHebrew
      ? new RegExp(`(?:^|[^\\u0590-\\u05FF])${HEBREW_PREFIX}${name}(?=$|[^\\u0590-\\u05FF])`, "u")
      : new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i");
    if (re.test(lower)) return { channel: name, vendor: CHANNEL_VENDOR[name] };
  }
  return null;
}

/// Does `text` look like connecting a vendor to the product? Returns the
/// first vendor name it finds, or a signal without a name, or null.
///
/// `known` is every vendor that needs no new run: the site's register and
/// the vendors that already had one. A known name found next to an action
/// word is reported as `existingVendor`, so the caller can note it on that
/// vendor's run instead of opening another.
export function detectVendorSignal(text: string, known: string[]): VendorSignal | null {
  const t = withoutCode(text ?? "").replace(HEBREW_NOT_CONNECTING, " ").trim();
  if (!t) return null;
  const knownKeys = new Map(known.map((k) => [vendorKey(k), k]));

  let bareHebrew: string | null = null;
  for (const sentence of sentencesOf(t)) {
    const hebrew = sentence.match(hebrewActionRe);
    const latin = sentence.match(latinActionRe);
    if (!hebrew && !latin) continue;
    const action = (hebrew?.[1] ?? latin?.[1] ?? "").trim();
    const actionAt = hebrew ? (hebrew.index ?? 0) + hebrew[0].indexOf(hebrew[1]) : latin?.index ?? 0;

    // A candidate vendor: a Latin token that is not technology, a common
    // word or one of our codes. Two capitalised tokens in a row read as one
    // name. A word in lower case counts only right next to the action word
    // ("לחבר את pipedrive"), since prose is full of lower-case words.
    const tokens = latinTokens(sentence);
    const candidates: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i].word;
      const lower = w.toLowerCase();
      if (NOT_A_VENDOR.has(lower) || COMMON_WORDS.has(lower) || OUR_CODE.test(w) || w.length < 2) continue;
      if (!/^[A-Z0-9]/.test(w)) {
        if (w.length < 4 || Math.abs(tokens[i].index - actionAt) > action.length + 12) continue;
      }
      let name = w;
      const next = tokens[i + 1];
      if (
        next &&
        /^[A-Z]/.test(w) &&
        /^[A-Z]/.test(next.word) &&
        !NOT_A_VENDOR.has(next.word.toLowerCase()) &&
        !COMMON_WORDS.has(next.word.toLowerCase()) &&
        sentence.slice(tokens[i].index + w.length, next.index).trim() === ""
      ) {
        name = `${w} ${next.word}`;
        i++;
      }
      candidates.push(name);
    }

    for (const c of candidates) {
      const key = vendorKey(c);
      const existing = knownKeys.get(key) ?? (CHANNEL_VENDOR[key] ? knownKeys.get(vendorKey(CHANNEL_VENDOR[key])) ?? CHANNEL_VENDOR[key] : undefined);
      if (existing) return { vendor: c, existingVendor: existing, matched: `${action} + ${c}` };
      // A single word that is itself an action word is not a name.
      if (LATIN_ACTIONS.includes(key)) continue;
      return { vendor: c, existingVendor: null, matched: `${action} + ${c}` };
    }

    // No Latin name: maybe a channel written in Hebrew ("לחבר וואטסאפ").
    const channel = channelVendorOf(sentence);
    if (channel) {
      return { vendor: channel.channel, existingVendor: channel.vendor, matched: `${action} + ${channel.channel}` };
    }

    // Only technology words, with no name at all ("להוסיף API"): a bare
    // Latin action is too common to ask about. The Hebrew verb of
    // connecting is asked about even without a name, once nothing better
    // turned up in another sentence.
    if (hebrew && HEBREW_BARE_ACTIONS.has(hebrew[1]) && !bareHebrew) bareHebrew = hebrew[1];
  }
  return bareHebrew ? { vendor: null, existingVendor: null, matched: bareHebrew } : null;
}
