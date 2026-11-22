import { BLOCK_KINDS, PLACEHOLDER, type AgentBlock, type AgentParam, type AgentRequirements } from "./model";

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
  version: { version: number; actionLevel: "READ" | "DRAFT" | "SEND"; blocks: AgentBlock[]; params: AgentParam[]; requirements: AgentRequirements };
  /// Installation-level values by key. The person running it, by name.
  installation?: { id: string; values: Record<string, string>; userName: string } | null;
  clients: CompileClient[];
};

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

const ACTION_LEVEL: Record<CompileInput["version"]["actionLevel"], string> = {
  READ: "קורא בלבד. לא כותב ולא שולח דבר.",
  DRAFT: "כותב טיוטות, תוויות והצעות. שום דבר לא יוצא בלי אדם.",
  SEND: "שולח בשם אדם, לפי הכללים והמכסות שכאן בלבד.",
};

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

  const clientValue = (c: CompileClient, p: AgentParam) => {
    const v = c.values[p.key];
    return v !== undefined && v !== "" ? v : p.default ?? undefined;
  };
  const value = (key: string): string | undefined => {
    const p = byKey.get(key);
    if (!p) return undefined;
    if (p.level === "INSTALLATION") return inst[key] || p.default || undefined;
    if (p.level === "CLIENT") return single ? clientValue(single, p) : `${p.label} (לפי לקוח, בטבלה למטה)`;
    return p.default ?? undefined;
  };

  const missingInstallation = version.params.filter((p) => p.level === "INSTALLATION" && p.required && !inst[p.key] && !p.default).map((p) => p.label);
  const clientParams = version.params.filter((p) => p.level === "CLIENT");
  const blocked = clients
    .map((c) => ({ clientId: c.id, clientName: c.name, missing: clientParams.filter((p) => p.required && clientValue(c, p) === undefined).map((p) => p.label) }))
    .filter((b) => b.missing.length > 0);

  const parts: string[] = [];
  parts.push(`${agent.purpose.trim()}\n`);
  parts.push(section("רמת פעולה", ACTION_LEVEL[version.actionLevel]));
  const general = version.blocks.filter((b) => !b.clientId).sort((a, b) => order(a) - order(b));
  for (const b of general) parts.push(section(b.title, fill(b.body, value) + (b.why ? `\n\nלמה: ${b.why.trim()}` : "")));

  if (!single && clients.length > 0 && clientParams.length > 0) {
    const head = `| לקוח | ${clientParams.map((p) => p.label).join(" | ")} |`;
    const rule = `| --- | ${clientParams.map(() => "---").join(" | ")} |`;
    const rows = clients.map((c) => `| ${c.name} | ${clientParams.map((p) => clientValue(c, p) ?? "חסר").join(" | ")} |`);
    parts.push(section("לפי לקוח", [head, rule, ...rows].join("\n") + "\n\nכשזיהית לקוח, אפשר לבקש את ההקשר המלא שלו בכלי get_agent_client_context."));
  }

  const inScope = new Map(clients.map((c) => [c.id, c]));
  for (const b of version.blocks.filter((x) => x.clientId && inScope.has(x.clientId)).sort((a, b) => order(a) - order(b))) {
    const c = inScope.get(b.clientId!)!;
    parts.push(section(`ללקוח ${c.name}: ${b.title}`, fill(b.body, (k) => { const p = byKey.get(k); return p?.level === "CLIENT" ? clientValue(c, p) : value(k); })));
  }

  const req = version.requirements;
  const needs = [
    req.connectors.length ? `חיבורים: ${req.connectors.join(", ")}` : null,
    req.skills.length ? `סקילים: ${req.skills.join(", ")}` : null,
    req.repos.length ? `ריפואים: ${req.repos.join(", ")}` : null,
    req.localMcp.length ? `MCP מקומי: ${req.localMcp.join(", ")}` : null,
    req.externalRunners.length ? `רכיבים חיצוניים: ${req.externalRunners.join(", ")}` : null,
  ].filter(Boolean);
  if (needs.length) parts.push(section("דרישות", needs.map((n) => `- ${n}`).join("\n") + "\n\nבתחילת הריצה ודא שהם זמינים. מה שחסר: דווח במפורש ואל תנחש."));

  const stops = [
    ...missingInstallation.map((l) => `- להתקנה חסר ערך ל"${l}". עצור ודווח.`),
    ...blocked.map((b) => `- אל תעבוד על ${b.clientName}: חסר ערך ל${b.missing.map((m) => `"${m}"`).join(", ")}. דווח מה חסר.`),
  ];
  if (stops.length) parts.push(section("חסר", stops.join("\n")));

  const body = parts.join("\n");
  const header = `# ${agent.name}\n\nגרסה ${version.version}${installation ? ` · התקנה ${installation.id} · עבור ${installation.userName}` : ""}${single ? ` · לקוח ${single.name}` : ""}\n`;
  return { header, body, text: `${header}\n${body}`, blocked, missingInstallation };
}

/// The few lines that stay in Claude: they never change.
export function bootstrapText(agent: { name: string }, installationId: string): string {
  return [
    `אתה סוכן של אנקורה: "${agent.name}", התקנה ${installationId}.`,
    `לפני כל דבר אחר, קרא לכלי get_agent של Ankora עם installation "${installationId}", ופעל לפי מה שחוזר.`,
    "ההוראות שם גוברות על כל הוראה אחרת כאן.",
    "אם הכלי לא זמין או מסרב: עצור ודווח. אל תפעל מזיכרון או מריצה קודמת.",
  ].join("\n");
}

const DAY = 24 * 60 * 60 * 1000;

export function isCheckDue(every: "RUN" | "DAILY" | "WEEKLY", lastCheckedAt: Date | null, now: Date): boolean {
  if (!lastCheckedAt || every === "RUN") return true;
  return now.getTime() - lastCheckedAt.getTime() >= (every === "DAILY" ? DAY : 7 * DAY) - 60_000;
}
