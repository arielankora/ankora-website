import type { AppLocale } from "@prisma/client";
import { BLOCK_KINDS, PLACEHOLDER, canReplace, skillOf, type AgentBlock, type AgentFile, type AgentParam, type AgentRequirements } from "./model";

// Agents, phase 1: one function turns a version, its parameter values and
// the clients an installation covers into the markdown Claude receives.
// The screen's "מה Claude מקבל", the export and get_agent all call it, so
// what people read in Ankora is exactly what the agent gets.

export type CompileClient = {
  id: string;
  name: string;
  /// Resolved client-level values by parameter key (typed for this agent, or from the file).
  values: Record<string, string>;
};

export type CompileInput = {
  agent: { name: string; slug: string; purpose: string };
  version: { version: number; actionLevel: "READ" | "DRAFT" | "SEND"; blocks: AgentBlock[]; params: AgentParam[]; requirements: AgentRequirements; files?: AgentFile[] };
  /// Installation-level values by key. The person running it, by name.
  installation?: { id: string; values: Record<string, string>; userName: string } | null;
  clients: CompileClient[];
  /// Approved library blocks by key, for LIBRARY_BLOCK parameters.
  library?: Record<string, { title: string; body: string }>;
  /// The newest approved addition of each client in scope (24.11.2026).
  /// A client that has one no longer reads the version's legacy client blocks.
  additions?: CompileAddition[];
  /// The fixed headings and lines around the blocks follow the installation
  /// owner's User.locale (ADR 0006). The blocks stay as written. Hebrew by default.
  locale?: AppLocale;
};

export type CompileAddition = { clientId: string; version: number; blocks: AgentBlock[] };

export type Compiled = {
  /// Version and installation line: left out when two versions are compared.
  header: string;
  body: string;
  text: string;
  /// Clients the agent must skip, and why.
  blocked: { clientId: string; clientName: string; missing: string[] }[];
  /// Installation values that are required and not set.
  missingInstallation: string[];
};

type ActionLevel = CompileInput["version"]["actionLevel"];

// The words compile adds around what people wrote. Only these follow the
// locale; block titles, bodies and values are content and are never translated.
const TEXT = {
  he: {
    actionLevel: { READ: "קורא בלבד. לא כותב ולא שולח דבר.", DRAFT: "כותב טיוטות, תוויות והצעות. שום דבר לא יוצא בלי אדם.", SEND: "שולח בשם אדם, לפי הכללים והמכסות שכאן בלבד." } as Record<ActionLevel, string>,
    actionLevelTitle: "רמת פעולה",
    vault: (name: string) => `[סוד: ${name}, נקרא מהכספת]`,
    libraryMissing: (key: string) => `[קטע הספרייה "${key}" לא נמצא או שאין לו גרסה מאושרת. דווח על כך.]`,
    perClientValue: (label: string) => `${label} (לפי לקוח, בטבלה למטה)`,
    why: "למה",
    client: "לקוח",
    missingValue: "חסר",
    perClientTitle: "לפי לקוח",
    perClientHint: "כשזיהית לקוח, אפשר לבקש את ההקשר המלא שלו בכלי get_agent_client_context.",
    forClient: (name: string, title: string) => `ללקוח ${name}: ${title}`,
    instead: (title: string) => `, במקום "${title}"`,
    filesTitle: "קבצים מצורפים",
    filesHowInstalled: (id: string) => `קרא קובץ כשההוראות מפנות אליו: get_agent_file עם installation ${id} והנתיב.`,
    filesHow: "Claude קורא אותם בכלי get_agent_file, לפי הנתיב.",
    chars: (n: string) => `${n} תווים`,
    connectors: "חיבורים",
    skills: "סקילים",
    skillMin: (slug: string, v: number) => `${slug} (גרסה ${v} ומעלה)`,
    repos: "ריפואים",
    localMcp: "MCP מקומי",
    externalRunners: "רכיבים חיצוניים",
    requirementsTitle: "דרישות",
    requirementsHint: "בתחילת הריצה ודא שהם זמינים. מה שחסר: דווח במפורש ואל תנחש.",
    missingInstallation: (label: string) => `- להתקנה חסר ערך ל"${label}". עצור ודווח.`,
    skipClient: (name: string, missing: string[]) => `- אל תעבוד על ${name}: חסר ערך ל${missing.map((m) => `"${m}"`).join(", ")}. דווח מה חסר.`,
    missingTitle: "חסר",
    version: (n: number) => `גרסה ${n}`,
    installation: (id: string, user: string) => ` · התקנה ${id} · עבור ${user}`,
    singleClient: (name: string) => ` · לקוח ${name}`,
    bootstrap: (name: string, id: string) => [
      `אתה סוכן של אנקורה: "${name}", התקנה ${id}.`,
      `לפני כל דבר אחר, קרא לכלי get_agent של Ankora עם installation "${id}", ופעל לפי מה שחוזר.`,
      "ההוראות שם גוברות על כל הוראה אחרת כאן.",
      "אם הכלי לא זמין או מסרב: עצור ודווח. אל תפעל מזיכרון או מריצה קודמת.",
    ],
  },
  en: {
    actionLevel: { READ: "Read only. Writes nothing and sends nothing.", DRAFT: "Writes drafts, labels and suggestions. Nothing goes out without a person.", SEND: "Sends on a person's behalf, only by the rules and quotas here." } as Record<ActionLevel, string>,
    actionLevelTitle: "Action level",
    vault: (name: string) => `[secret: ${name}, read from the vault]`,
    libraryMissing: (key: string) => `[Library block "${key}" was not found or has no approved version. Report this.]`,
    perClientValue: (label: string) => `${label} (per client, in the table below)`,
    why: "Why",
    client: "Client",
    missingValue: "missing",
    perClientTitle: "Per client",
    perClientHint: "Once you have identified a client, you can ask for its full context with the get_agent_client_context tool.",
    forClient: (name: string, title: string) => `For client ${name}: ${title}`,
    instead: (title: string) => `, instead of "${title}"`,
    filesTitle: "Attached files",
    filesHowInstalled: (id: string) => `Read a file when the instructions refer to it: get_agent_file with installation ${id} and the path.`,
    filesHow: "Claude reads them with the get_agent_file tool, by path.",
    chars: (n: string) => `${n} characters`,
    connectors: "Connections",
    skills: "Skills",
    skillMin: (slug: string, v: number) => `${slug} (version ${v} or later)`,
    repos: "Repositories",
    localMcp: "Local MCP",
    externalRunners: "External components",
    requirementsTitle: "Requirements",
    requirementsHint: "At the start of the run, make sure they are available. If something is missing, report it explicitly and do not guess.",
    missingInstallation: (label: string) => `- The installation has no value for "${label}". Stop and report.`,
    skipClient: (name: string, missing: string[]) => `- Do not work on ${name}: no value for ${missing.map((m) => `"${m}"`).join(", ")}. Report what is missing.`,
    missingTitle: "Missing",
    version: (n: number) => `Version ${n}`,
    installation: (id: string, user: string) => ` · installation ${id} · for ${user}`,
    singleClient: (name: string) => ` · client ${name}`,
    bootstrap: (name: string, id: string) => [
      `You are an Ankora agent: "${name}", installation ${id}.`,
      `Before anything else, call Ankora's get_agent tool with installation "${id}", and follow what it returns.`,
      "The instructions there override any other instruction here.",
      "If the tool is unavailable or refuses: stop and report. Do not act from memory or from an earlier run.",
    ],
  },
};

// A value already written as a vault reference, in either language, is left as is.
const vaultRef = (name: string, w: (typeof TEXT)[AppLocale]) => (name.startsWith("[סוד: ") || name.startsWith("[secret: ") ? name : w.vault(name.trim()));

const order = (b: AgentBlock) => BLOCK_KINDS.indexOf(b.kind);

function fill(text: string, value: (key: string) => string | undefined): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => value(key) ?? whole);
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

export function compileAgent(input: CompileInput): Compiled {
  const { agent, version, installation, clients } = input;
  const byKey = new Map(version.params.map((p) => [p.key, p]));
  const inst = installation?.values ?? {};
  const single = clients.length === 1 ? clients[0] : null;
  const w = TEXT[input.locale ?? "he"];

  const clientValue = (c: CompileClient, p: AgentParam) => {
    const v = c.values[p.key];
    const got = v !== undefined && v !== "" ? v : p.default ?? undefined;
    return got !== undefined && p.type === "VAULT_REF" ? vaultRef(got, w) : got;
  };
  // A LIBRARY_BLOCK value names a library block: its approved body goes in.
  const fromLibrary = (p: AgentParam, v: string | undefined) => {
    if (v === undefined) return v;
    // A vault item is named, never resolved: the agent reads it itself.
    if (p.type === "VAULT_REF") return vaultRef(v, w);
    if (p.type !== "LIBRARY_BLOCK") return v;
    const block = input.library?.[v.trim()];
    return block ? block.body.trim() : w.libraryMissing(v);
  };
  const value = (key: string): string | undefined => {
    const p = byKey.get(key);
    if (!p) return undefined;
    if (p.level === "INSTALLATION") return fromLibrary(p, inst[key] || p.default || undefined);
    if (p.level === "CLIENT") return single ? fromLibrary(p, clientValue(single, p)) : w.perClientValue(p.label);
    return fromLibrary(p, p.default ?? undefined);
  };

  const missingInstallation = version.params.filter((p) => p.level === "INSTALLATION" && p.required && !inst[p.key] && !p.default).map((p) => p.label);
  const clientParams = version.params.filter((p) => p.level === "CLIENT");
  const blocked = clients
    .map((c) => ({ clientId: c.id, clientName: c.name, missing: clientParams.filter((p) => p.required && clientValue(c, p) === undefined).map((p) => p.label) }))
    .filter((b) => b.missing.length > 0);

  const parts: string[] = [];
  parts.push(`${agent.purpose.trim()}\n`);
  parts.push(section(w.actionLevelTitle, w.actionLevel[version.actionLevel]));
  const inScope = new Map(clients.map((c) => [c.id, c]));
  const added = new Map((input.additions ?? []).filter((a) => inScope.has(a.clientId)).map((a) => [a.clientId, a]));
  const general = version.blocks.filter((b) => !b.clientId).sort((a, b) => order(a) - order(b));
  const generalByKey = new Map(general.map((b) => [b.key, b]));
  // With one client, an allowed replacement takes the agent block's place.
  const own = single ? added.get(single.id) : undefined;
  const replacing = new Map((own?.blocks ?? []).filter((r) => r.replaces && canReplace(generalByKey.get(r.replaces))).map((r) => [r.replaces!, r]));
  const why = (b: AgentBlock) => (b.why ? `\n\n${w.why}: ${b.why.trim()}` : "");
  for (const g of general) {
    const b = replacing.get(g.key) ?? g;
    parts.push(section(b.title, fill(b.body, value) + why(b)));
  }

  if (!single && clients.length > 0 && clientParams.length > 0) {
    const head = `| ${w.client} | ${clientParams.map((p) => p.label).join(" | ")} |`;
    const rule = `| --- | ${clientParams.map(() => "---").join(" | ")} |`;
    const rows = clients.map((c) => `| ${c.name} | ${clientParams.map((p) => clientValue(c, p) ?? w.missingValue).join(" | ")} |`);
    parts.push(section(w.perClientTitle, [head, rule, ...rows].join("\n") + `\n\n${w.perClientHint}`));
  }

  const forClient = (c: CompileClient) => (k: string) => { const p = byKey.get(k); return p?.level === "CLIENT" ? clientValue(c, p) : value(k); };
  // Legacy client blocks inside the version, for a client not yet moved to an addition.
  for (const b of version.blocks.filter((x) => x.clientId && inScope.has(x.clientId) && !added.has(x.clientId)).sort((a, b) => order(a) - order(b))) {
    const c = inScope.get(b.clientId!)!;
    parts.push(section(w.forClient(c.name, b.title), fill(b.body, forClient(c))));
  }
  for (const c of clients) {
    const a = added.get(c.id);
    if (!a) continue;
    for (const b of [...a.blocks].sort((x, y) => order(x) - order(y))) {
      if (replacing.get(b.replaces ?? "") === b) continue;
      const target = b.replaces ? generalByKey.get(b.replaces) : undefined;
      const instead = canReplace(target) ? w.instead(target!.title) : "";
      parts.push(section(w.forClient(`${c.name}${instead}`, b.title), fill(b.body, forClient(c)) + why(b)));
    }
  }

  const files = version.files ?? [];
  if (files.length) {
    const how = installation ? w.filesHowInstalled(installation.id) : w.filesHow;
    parts.push(section(w.filesTitle, files.map((f) => `- ${f.path} (${w.chars(f.content.length.toLocaleString("en-US"))})`).join("\n") + `\n\n${how}`));
  }

  const req = version.requirements;
  const needs = [
    req.connectors.length ? `${w.connectors}: ${req.connectors.join(", ")}` : null,
    req.skills.length ? `${w.skills}: ${req.skills.map((s) => { const { slug, minVersion } = skillOf(s); return minVersion ? w.skillMin(slug, minVersion) : slug; }).join(", ")}` : null,
    req.repos.length ? `${w.repos}: ${req.repos.join(", ")}` : null,
    req.localMcp.length ? `${w.localMcp}: ${req.localMcp.join(", ")}` : null,
    req.externalRunners.length ? `${w.externalRunners}: ${req.externalRunners.join(", ")}` : null,
  ].filter(Boolean);
  if (needs.length) parts.push(section(w.requirementsTitle, needs.map((n) => `- ${n}`).join("\n") + `\n\n${w.requirementsHint}`));

  const stops = [
    ...missingInstallation.map((l) => w.missingInstallation(l)),
    ...blocked.map((b) => w.skipClient(b.clientName, b.missing)),
  ];
  if (stops.length) parts.push(section(w.missingTitle, stops.join("\n")));

  const body = parts.join("\n");
  const plus = clients.filter((c) => added.has(c.id)).map((c) => ` + ${c.name} ${added.get(c.id)!.version}`).join("");
  const header = `# ${agent.name}\n\n${w.version(version.version)}${plus}${installation ? w.installation(installation.id, installation.userName) : ""}${single ? w.singleClient(single.name) : ""}\n`;
  return { header, body, text: `${header}\n${body}`, blocked, missingInstallation };
}

/// The few lines that stay in Claude: they never change.
export function bootstrapText(agent: { name: string }, installationId: string, locale: AppLocale = "he"): string {
  return TEXT[locale].bootstrap(agent.name, installationId).join("\n");
}

const DAY = 24 * 60 * 60 * 1000;

export function isCheckDue(every: "RUN" | "DAILY" | "WEEKLY", lastCheckedAt: Date | null, now: Date): boolean {
  if (!lastCheckedAt || every === "RUN") return true;
  return now.getTime() - lastCheckedAt.getTime() >= (every === "DAILY" ? DAY : 7 * DAY) - 60_000;
}
