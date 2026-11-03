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

/// Codes the team writes all day that are not names: a process (P15), a
/// source in a client file (S28), a pull request (PR400), a version (v2,
/// 1.0). 3.11.2026: "MCP + P15" in a task about the approvals screen read
/// as connecting a vendor called P15.
const CODE_LIKE = /^(?:[A-Za-z]{1,3}\d+|v?\d+(?:\.\d+)*)$/;

/// Capitalised words that start sentences and titles in product work and
/// are never a vendor. 3.11.2026: "integration tests" and the like.
const COMMON_WORDS = new Set(
  [
    "test", "tests", "testing", "integration", "integrations", "unit", "e2e", "admin", "dashboard", "portal",
    "page", "screen", "task", "tasks", "user", "users", "data", "file", "files", "report", "reports", "mobile",
    "web", "email", "mail", "login", "auth", "settings", "preview", "production", "staging", "main", "branch",
    "bug", "fix", "feature", "old", "draft", "plan", "step", "steps", "process", "client", "clients", "team",
    "home", "app", "apps", "tool", "tools", "connector", "connectors", "server", "service", "services", "system",
    "systems", "account", "accounts", "error", "errors", "check", "checks", "flow", "flows", "job", "jobs",
    "cron", "list", "lists", "view", "views", "card", "button", "form", "forms", "table", "tables", "field",
    "fields", "note", "notes", "comment", "comments", "link", "links", "id", "ids", "url", "urls", "json", "csv",
    "pdf", "html", "css", "ts", "js", "node", "next", "react", "prisma", "vitest", "playwright", "github",
  ].map((w) => w.toLowerCase())
);

function isNotAName(word: string): boolean {
  const w = word.toLowerCase();
  return NOT_A_VENDOR.has(w) || COMMON_WORDS.has(w) || CODE_LIKE.test(word);
}

/// A vendor's name as people write it: a capital letter first, at least
/// three characters, a dot or dash inside allowed (Meet-Alfred, Cal.com),
/// and a second capitalised word kept with it (Meet Alfred, Google Drive).
const NAME = "([A-Z][A-Za-z0-9][A-Za-z0-9.\\-]*[A-Za-z0-9](?:\\s+[A-Z][A-Za-z0-9.\\-]*[A-Za-z0-9])?)";

/// Hebrew verbs of connecting, with the words that sit between the verb
/// and the name: "לחבר את X", "חיבור ל-X", "האינטגרציה עם X", "להירשם ל-X".
const HEBREW_CONNECT = ["לחבר", "לחיבור", "חיבור", "מחבר", "אינטגרציה", "אינטגרציית", "להירשם", "הרשמה", "להטמיע", "הטמעת"];
const HEBREW_FILLER = "(?:\\s+(?:את|עם|אל|של|גם))?\\s+(?:[לבה][-־]?)?";
/// English verbs of connecting: "connect X", "integrate with X",
/// "sign up for X", "onboard X".
const ENGLISH_CONNECT = "(?:[Cc]onnect(?:s|ed|ing)?|[Ii]ntegrat(?:e|es|ed|ing|ion)\\s+with|[Ss]ign(?:ing)?[\\s-]?up\\s+(?:for|to|with)|[Oo]nboard(?:s|ed|ing)?)";
/// Technology words that name what is being connected, right after the
/// vendor ("Twilio API", "Notion MCP") or right before it ("MCP של Notion").
const TECH = "(?:MCP|API|SDK|OAuth|[Ww]ebhooks?|[Cc]onnector|[Ii]ntegration)";

const PATTERNS: { re: RegExp; label: (m: RegExpMatchArray) => string }[] = [
  {
    re: new RegExp(`(?:^|[^\\u0590-\\u05FF])${HEBREW_PREFIX}(${HEBREW_CONNECT.join("|")})${HEBREW_FILLER}${NAME}`, "gu"),
    label: (m) => m[1],
  },
  { re: new RegExp(`\\b(${ENGLISH_CONNECT})\\s+(?:to\\s+|with\\s+|the\\s+)?${NAME}`, "g"), label: (m) => m[1] },
  { re: new RegExp(`${NAME}\\s+(${TECH})\\b`, "g"), label: (m) => m[2] },
  {
    re: new RegExp(`\\b(${TECH})\\s+(?:של|ל-?|for|of|to|with)\\s*${NAME}`, "gu"),
    label: (m) => m[1],
  },
];

/// The name group of a match: the last capture that looks like a name.
function nameOf(m: RegExpMatchArray, pattern: number): string {
  return pattern === 2 ? m[1] : m[2];
}

/// A name that is part of an email address or a web address is not one.
function insideAddress(text: string, index: number, length: number): boolean {
  const before = text[index - 1] ?? "";
  const after = text[index + length] ?? "";
  return before === "@" || before === "/" || before === "." || after === "@";
}

/// Keeps the usable part of a captured name: a second word that is not a
/// name is dropped ("Pipedrive Tests" is Pipedrive), and a first word
/// that is not a name drops the whole capture.
function cleanName(raw: string): string | null {
  const words = raw.trim().split(/\s+/);
  if (isNotAName(words[0]) || words[0].length < 3) return null;
  if (words.length > 1 && isNotAName(words[1])) return words[0];
  return words.join(" ");
}

function channelAfterVerb(text: string): { channel: string; vendor: string; action: string } | null {
  const names = Object.keys(CHANNEL_VENDOR)
    .filter((n) => /[\u0590-\u05FF]/.test(n))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(?:^|[^\\u0590-\\u05FF])${HEBREW_PREFIX}(${HEBREW_CONNECT.join("|")})${HEBREW_FILLER}(${names.join("|")})(?=$|[^\\u0590-\\u05FF])`,
    "u"
  );
  const m = text.match(re);
  return m ? { action: m[1], channel: m[2], vendor: CHANNEL_VENDOR[m[2]] } : null;
}

export function detectVendorSignal(text: string, known: string[]): VendorSignal | null {
  const cleaned = withoutCode(text ?? "").replace(HEBREW_NOT_CONNECTING, " ").trim();
  if (!cleaned) return null;
  const knownKeys = new Map(known.map((k) => [vendorKey(k), k]));

  // 3.11.2026, after false alarms in production: only an explicit act of
  // connecting a named vendor counts. Technology words alone (MCP, API,
  // integration) are everyday product work, and a lower-case word, an
  // email address or a code is never a name. Whatever this misses, a new
  // dependency or environment variable in the code is caught by QA
  // (qa/checks/new-vendors.mjs), and Claude asks from context.
  for (const t of sentencesOf(cleaned)) {
    for (const [i, { re, label }] of PATTERNS.entries()) {
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) {
        const raw = nameOf(m, i);
        const at = (m.index ?? 0) + m[0].indexOf(raw);
        if (insideAddress(t, at, raw.length)) continue;
        const name = cleanName(raw);
        if (!name) continue;
        const action = label(m).trim();
        const key = vendorKey(name);
        const existing =
          knownKeys.get(key) ?? (CHANNEL_VENDOR[key] ? knownKeys.get(vendorKey(CHANNEL_VENDOR[key])) ?? CHANNEL_VENDOR[key] : undefined);
        return { vendor: name, existingVendor: existing ?? null, matched: `${action} + ${name}` };
      }
    }
  }

  // A channel of a vendor we have, written in Hebrew ("לחבר וואטסאפ").
  const channel = channelAfterVerb(cleaned);
  if (channel) return { vendor: channel.channel, existingVendor: channel.vendor, matched: `${channel.action} + ${channel.channel}` };
  return null;
}/// From #413 (3.11.2026): what is code, not prose, is removed before
/// reading: inline code, URLs, paths, and identifiers (camelCase,
/// snake_case, file.ext). A path like tests/integration/x.test.ts says
/// neither "integration" nor "tests".
const HEBREW_NOT_CONNECTING = /(?:בדיקות|בדיקת|טסטים של|טסט)\s+(?:יחידה,?\s+)?אינטגרציה/gu;

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


