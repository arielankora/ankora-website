import "server-only";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { PROMPT_KINDS, type PromptKind } from "@/lib/claude-usage/prompt-kinds";
import { managerSummary, type ManagerSummary } from "@/lib/claude-usage/summary";
import { personLimits, type PersonLimits } from "@/lib/claude-usage/limits";
import { WEEK_MS, personFiveHour, teamFiveHour, type PersonFiveHour, type TeamFiveHour } from "@/lib/claude-usage/five-hour";
import {
  ankoraToolFor,
  briefThenFile,
  duplicateReads,
  fiveHourWindows,
  heaviestWindow,
  WINDOW_MS,
  isLimitHit,
  requestsBySource,
  type SourceKey,
  round2,
  type CoworkEventIn,
  type ToolCallIn,
} from "@/lib/claude-usage/report-math";

// Claude usage measurement, stage 3 (17.11.2026): what the "שימוש בקלוד"
// screen and the get_claude_usage tool show. One report, built here, so
// the screen and Claude read the same numbers.
//
// Three sources, all written by Ankora itself:
//   mcp_tool_calls        every call to the staff connector (stage 1),
//                         from Cowork, the browser and the phone alike
//   claude_prompt_copies  every prompt the app copied for Claude (stage 1)
//   cowork_events         Cowork's telemetry: model, tokens, estimated
//                         cost, and the errors where a limit shows (stage 2)
//
// Who sees it: claude_usage.view, SUPER_ADMIN only. The refusal is a
// DomainError so it reaches Claude in its own words.

export const USAGE_PERIODS = [7, 30] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export const CLAUDE_USAGE_SETTINGS_KEY = "claude_usage.settings";

/// 18.11.2026: the seat price, the multiplier and the alerts switch are
/// gone. Cowork's cost is what the work would cost at API list prices, not
/// money spent, and on a Team seat the only limits are the five-hour window
/// and the weekly limit, read by the browser extension. Comparing that cost
/// with the seat price marked Ariel "over" at $270 on a $100 seat while he
/// had used 9% of his window. Stored settings with those fields still read.
export type ClaudeUsageSettings = {
  /// People who do not work in Cowork (17.11.2026: Ankora Ops works in
  /// Claude Code). Their missing telemetry is expected: they are not
  /// flagged, and they do not make the summary "data missing".
  nonCowork: string[];
};

export const DEFAULT_SETTINGS: ClaudeUsageSettings = { nonCowork: [] };

function assertCanView(actor: Pick<User, "role">) {
  if (!can(actor.role, "claude_usage.view")) {
    throw new DomainError(
      "claudeUsage.forbidden",
      "רק מנהל-על רואה את השימוש של הצוות בקלוד."
    );
  }
}

function readSettings(value: Prisma.JsonValue | undefined): ClaudeUsageSettings {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return { nonCowork: Array.isArray(v.nonCowork) ? v.nonCowork.filter((id): id is string => typeof id === "string") : [] };
}

export async function claudeUsageSettings(): Promise<ClaudeUsageSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: CLAUDE_USAGE_SETTINGS_KEY } });
  return readSettings(row?.value);
}

export type SettingsInput = {
  /// userId → true when the person does not work in Cowork, false when
  /// they do. People left out keep what they had.
  nonCowork?: Record<string, boolean>;
};

export async function updateClaudeUsageSettings(actor: User, input: SettingsInput): Promise<ClaudeUsageSettings> {
  assertCanView(actor);
  const before = await claudeUsageSettings();
  const nonCowork = new Set(before.nonCowork);
  for (const [id, off] of Object.entries(input.nonCowork ?? {})) {
    if (off) nonCowork.add(id);
    else nonCowork.delete(id);
  }
  const after: ClaudeUsageSettings = { nonCowork: [...nonCowork].sort() };
  await prisma.appSetting.upsert({
    where: { key: CLAUDE_USAGE_SETTINGS_KEY },
    create: { key: CLAUDE_USAGE_SETTINGS_KEY, value: after as unknown as Prisma.InputJsonValue, updatedById: actor.id },
    update: { value: after as unknown as Prisma.InputJsonValue, updatedById: actor.id },
  });
  await recordAudit({
    actorId: actor.id,
    action: "claude_usage.settings",
    entityType: "AppSetting",
    entityId: CLAUDE_USAGE_SETTINGS_KEY,
    before: before as unknown as Prisma.InputJsonValue,
    after: after as unknown as Prisma.InputJsonValue,
  });
  return after;
}

// ------------------------------------------------------------------ report

export type PersonUsage = {
  userId: string;
  name: string;
  cowork: {
    requests: number;
    /// What the work would cost at API list prices (Cowork's estimate): a
    /// measure of how heavy it was, never money spent. A Team seat has a
    /// fixed price; its limits are the five-hour window and the week.
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /// Share of input that came from the cache: the higher, the cheaper.
    cacheSharePct: number | null;
    models: { model: string; requests: number; costUsd: number }[];
    limitHits: number;
    /// Requests and estimated cost by product: Cowork, Claude Code, other.
    bySource: { source: SourceKey; requests: number; costUsd: number }[];
    heaviestWindow: { start: string; costUsd: number; tokens: number; requests: number; limitHits: number } | null;
    lastEventAt: string | null;
  };
  connector: { calls: number; bytes: number; images: number; failures: number };
  prompts: { copies: number; chars: number };
  /// Uses the connector in the period but nothing arrived from Cowork:
  /// probably an old desktop app, or Cowork not used at all.
  noTelemetry: boolean;
  /// Marked on the screen as someone who does not work in Cowork.
  nonCowork: boolean;
  /// The browser extension's readings of this person's usage limits
  /// (way 3): null when none arrived in the period.
  limits: PersonLimits | null;
  /// The five-hour window: now, and the past week window by window
  /// (lib/claude-usage/five-hour.ts). The top of the screen.
  fiveHour: PersonFiveHour;
};

export type ToolUsage = {
  tool: string;
  calls: number;
  people: number;
  totalBytes: number;
  avgBytes: number;
  maxBytes: number;
  failures: number;
  truncated: number;
  images: number;
  duplicates: number;
};

export type ClaudeUsageReport = {
  period: { days: UsagePeriod; from: string; to: string };
  settings: ClaudeUsageSettings;
  /// The managers' summary: one verdict, six leading indicators against
  /// their targets, and at most three things to do (lib/claude-usage/summary.ts).
  summary: ManagerSummary;
  /// The team in the five-hour window: who is stuck now, who is close,
  /// hits this week and the hours they cluster in.
  fiveHour: TeamFiveHour;
  people: PersonUsage[];
  tools: ToolUsage[];
  prompts: { kind: PromptKind; copies: number; avgChars: number; maxChars: number }[];
  signals: { briefThenFile: number; duplicateReads: number; truncatedAnswers: number; limitHits: number };
  heaviestRequests: { promptId: string; name: string; at: string; costUsd: number; requests: number; models: string[]; ankoraTools: string[] }[];
  coverage: { coworkEvents: number; toolCalls: number; promptCopies: number; unmatchedEmails: string[]; limitReadings: number; unmatchedLimitEmails: string[] };
};

const isReadOnly = (tool: string) => (TOOL_ANNOTATIONS as Record<string, { readOnlyHint?: boolean }>)[tool]?.readOnlyHint === true;

function toCoworkIn(r: {
  eventName: string;
  userId: string | null;
  occurredAt: Date;
  promptId: string | null;
  model: string | null;
  costUsd: Prisma.Decimal | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  statusCode: string | null;
  errorText: string | null;
  toolName: string | null;
  toolResultBytes: number | null;
  mcpTool: string | null;
  source?: string | null;
}): CoworkEventIn {
  return { ...r, costUsd: r.costUsd === null ? null : Number(r.costUsd) };
}

export async function getClaudeUsageReport(actor: User, opts: { days?: number; now?: Date } = {}): Promise<ClaudeUsageReport> {
  assertCanView(actor);
  const now = opts.now ?? new Date();
  const days: UsagePeriod = opts.days === 30 ? 30 : 7;
  const from = new Date(now.getTime() - days * 86_400_000);
  // The five-hour view always shows the past week, plus the window that
  // was open a week ago, whatever the period.
  const fiveFrom = new Date(Math.min(from.getTime(), now.getTime() - WEEK_MS - WINDOW_MS));
  const settings = await claudeUsageSettings();

  const [users, calls, events, copies, unmatched, limitSamples, unmatchedLimits] = await Promise.all([
    prisma.user.findMany({
      // Active staff only: an invited or suspended person, or an old
      // duplicate account, has nothing to report and only confuses the list.
      where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] }, status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.mcpToolCall.findMany({ where: { createdAt: { gte: from, lte: now } } }),
    prisma.coworkEvent.findMany({
      where: { occurredAt: { gte: fiveFrom, lte: now } },
      select: {
        eventName: true,
        userId: true,
        occurredAt: true,
        promptId: true,
        model: true,
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        statusCode: true,
        errorText: true,
        toolName: true,
        toolResultBytes: true,
        mcpTool: true,
        source: true,
      },
    }),
    prisma.claudePromptCopy.findMany({ where: { createdAt: { gte: from, lte: now } } }),
    prisma.coworkEvent.findMany({
      where: { userId: null, userEmail: { not: null }, occurredAt: { gte: from, lte: now } },
      distinct: ["userEmail"],
      select: { userEmail: true },
      take: 20,
    }),
    // The browser extension's limit readings (way 3).
    prisma.claudeLimitSample.findMany({
      where: { observedAt: { gte: fiveFrom, lte: now }, userId: { not: null } },
      select: { userId: true, fiveHourPct: true, fiveHourResetsAt: true, sevenDayPct: true, sevenDayResetsAt: true, observedAt: true },
    }),
    // Readings the extension sent for an address no Ankora user has (both
    // the Claude account's and the Chrome profile's were tried): someone
    // signed in under an alias. Shown, so the reading is not lost silently.
    prisma.claudeLimitSample.findMany({
      where: { userId: null, observedAt: { gte: from, lte: now } },
      distinct: ["email"],
      select: { email: true },
      take: 20,
    }),
  ]);

  // Events and readings were read from fiveFrom; everything but the
  // five-hour view counts the period alone.
  const coworkAll = events.map(toCoworkIn);
  const coworkIn = coworkAll.filter((e) => e.occurredAt >= from);
  const limitInPeriod = limitSamples.filter((s) => s.observedAt >= from);
  const callIn: ToolCallIn[] = calls;
  const byUser = <T extends { userId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.userId) m.set(r.userId, [...(m.get(r.userId) ?? []), r]);
    return m;
  };
  const callsBy = byUser(callIn);
  const eventsBy = byUser(coworkIn);
  const allEventsBy = byUser(coworkAll);
  const copiesBy = byUser(copies);
  const limitsBy = byUser(limitInPeriod);
  const allLimitsBy = byUser(limitSamples);

  const people: PersonUsage[] = users.map((u) => {
    const ev = eventsBy.get(u.id) ?? [];
    const requests = ev.filter((e) => e.eventName === "api_request");
    const sum = (f: (e: CoworkEventIn) => number | null) => requests.reduce((n, e) => n + (f(e) ?? 0), 0);
    const input = sum((e) => e.inputTokens);
    const cacheRead = sum((e) => e.cacheReadTokens);
    const cacheCreation = sum((e) => e.cacheCreationTokens);
    const models = new Map<string, { requests: number; costUsd: number }>();
    for (const e of requests) {
      const key = e.model ?? "?";
      const m = models.get(key) ?? { requests: 0, costUsd: 0 };
      m.requests += 1;
      m.costUsd += e.costUsd ?? 0;
      models.set(key, m);
    }
    const heavy = heaviestWindow(fiveHourWindows(ev));
    const userCalls = callsBy.get(u.id) ?? [];
    const userCopies = copiesBy.get(u.id) ?? [];
    const last = ev.reduce<Date | null>((d, e) => (!d || e.occurredAt > d ? e.occurredAt : d), null);
    const allInput = input + cacheRead + cacheCreation;
    return {
      userId: u.id,
      name: u.name,
      cowork: {
        requests: requests.length,
        costUsd: round2(sum((e) => e.costUsd)),
        inputTokens: input,
        outputTokens: sum((e) => e.outputTokens),
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        cacheSharePct: allInput > 0 ? Math.round((cacheRead / allInput) * 100) : null,
        models: [...models.entries()].map(([model, m]) => ({ model, requests: m.requests, costUsd: round2(m.costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
        limitHits: ev.filter(isLimitHit).length,
        bySource: requestsBySource(ev),
        heaviestWindow: heavy ? { start: heavy.start.toISOString(), costUsd: round2(heavy.costUsd), tokens: heavy.tokens, requests: heavy.requests, limitHits: heavy.limitHits } : null,
        lastEventAt: last?.toISOString() ?? null,
      },
      connector: {
        calls: userCalls.length,
        bytes: userCalls.reduce((n, c) => n + c.resultBytes, 0),
        images: userCalls.reduce((n, c) => n + c.imageCount, 0),
        failures: userCalls.filter((c) => !c.ok).length,
      },
      prompts: { copies: userCopies.length, chars: userCopies.reduce((n, c) => n + c.chars, 0) },
      noTelemetry: !settings.nonCowork.includes(u.id) && userCalls.length > 0 && ev.length === 0,
      nonCowork: settings.nonCowork.includes(u.id),
      limits: limitsBy.has(u.id) ? personLimits(limitsBy.get(u.id)!, now) : null,
      fiveHour: personFiveHour(allLimitsBy.get(u.id) ?? [], allEventsBy.get(u.id) ?? [], now),
    };
  });
  // Busiest first; people with no activity at all stay, at the end, so a
  // missing person is visible rather than absent.
  people.sort((a, b) => b.cowork.costUsd - a.cowork.costUsd || b.connector.bytes - a.connector.bytes || a.name.localeCompare(b.name));

  const dups = duplicateReads(callIn, isReadOnly);
  const toolMap = new Map<string, ToolCallIn[]>();
  for (const c of callIn) toolMap.set(c.tool, [...(toolMap.get(c.tool) ?? []), c]);
  const tools: ToolUsage[] = [...toolMap.entries()]
    .map(([tool, cs]) => {
      const total = cs.reduce((n, c) => n + c.resultBytes, 0);
      return {
        tool,
        calls: cs.length,
        people: new Set(cs.map((c) => c.userId).filter(Boolean)).size,
        totalBytes: total,
        avgBytes: Math.round(total / cs.length),
        maxBytes: cs.reduce((n, c) => Math.max(n, c.resultBytes), 0),
        failures: cs.filter((c) => !c.ok).length,
        truncated: cs.filter((c) => c.truncated).length,
        images: cs.reduce((n, c) => n + c.imageCount, 0),
        duplicates: dups.get(tool) ?? 0,
      };
    })
    .sort((a, b) => b.totalBytes - a.totalBytes);

  const prompts = PROMPT_KINDS.map((kind) => {
    const cs = copies.filter((c) => c.kind === kind);
    return {
      kind,
      copies: cs.length,
      avgChars: cs.length ? Math.round(cs.reduce((n, c) => n + c.chars, 0) / cs.length) : 0,
      maxChars: cs.reduce((n, c) => Math.max(n, c.chars), 0),
    };
  }).filter((p) => p.copies > 0);

  // The heaviest single prompts: everything Cowork did for one message.
  const names = new Map(users.map((u) => [u.id, u.name]));
  const byPrompt = new Map<string, CoworkEventIn[]>();
  for (const e of coworkIn) if (e.promptId) byPrompt.set(e.promptId, [...(byPrompt.get(e.promptId) ?? []), e]);
  const heaviestRequests = [...byPrompt.entries()]
    .map(([promptId, es]) => {
      const reqs = es.filter((e) => e.eventName === "api_request");
      const userId = es.find((e) => e.userId)?.userId ?? null;
      const userCalls = userId ? (callsBy.get(userId) ?? []) : [];
      const ankoraTools = es.map((e) => ankoraToolFor(e, userCalls)).filter((t): t is string => !!t);
      return {
        promptId,
        name: (userId && names.get(userId)) || "?",
        at: es.reduce((d, e) => (e.occurredAt < d ? e.occurredAt : d), es[0].occurredAt).toISOString(),
        costUsd: round2(reqs.reduce((n, e) => n + (e.costUsd ?? 0), 0)),
        requests: reqs.length,
        models: [...new Set(reqs.map((e) => e.model).filter((m): m is string => !!m))],
        ankoraTools,
      };
    })
    .filter((r) => r.requests > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);

  const signals = {
    briefThenFile: briefThenFile(callIn),
    duplicateReads: [...dups.values()].reduce((n, d) => n + d, 0),
    truncatedAnswers: callIn.filter((c) => c.truncated).length,
    limitHits: coworkIn.filter(isLimitHit).length,
  };
  const coverage = {
    coworkEvents: coworkIn.length,
    toolCalls: calls.length,
    promptCopies: copies.length,
    unmatchedEmails: unmatched.map((u) => u.userEmail!).filter(Boolean),
    limitReadings: limitInPeriod.length,
    unmatchedLimitEmails: unmatchedLimits.map((u) => u.email).sort(),
  };

  return {
    period: { days, from: from.toISOString(), to: now.toISOString() },
    settings,
    summary: managerSummary({ people, tools, signals, coverage }),
    fiveHour: teamFiveHour(people),
    people,
    tools,
    prompts,
    signals,
    heaviestRequests,
    coverage,
  };
}
