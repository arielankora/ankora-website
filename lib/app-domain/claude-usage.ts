import "server-only";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { dayStartInZone, localDateKey } from "@/lib/timezone";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { PROMPT_KINDS, type PromptKind } from "@/lib/claude-usage/prompt-kinds";
import {
  ankoraToolFor,
  briefThenFile,
  duplicateReads,
  fiveHourWindows,
  heaviestWindow,
  isLimitHit,
  round2,
  seatStatus,
  type CoworkEventIn,
  type SeatStatus,
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

export type ClaudeUsageSettings = {
  /// The seat most people are on, in USD a month (17.11.2026: 20).
  defaultSeatUsd: number;
  /// Exceptions by user id (Ariel and ops: 100).
  seats: Record<string, number>;
  /// The threshold is seat × multiplier. 1 until two weeks of data say
  /// what a normal month looks like next to the seat price.
  multiplier: number;
  /// Off until the threshold is calibrated: the screen shows the status,
  /// nothing is sent.
  alertsLive: boolean;
};

export const DEFAULT_SETTINGS: ClaudeUsageSettings = { defaultSeatUsd: 20, seats: {}, multiplier: 1, alertsLive: false };

const SEAT_MIN = 1;
const SEAT_MAX = 1000;
const MULTIPLIER_MIN = 0.1;
const MULTIPLIER_MAX = 50;

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
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : fallback;
  const seats: Record<string, number> = {};
  if (v.seats && typeof v.seats === "object" && !Array.isArray(v.seats)) {
    for (const [id, usd] of Object.entries(v.seats as Record<string, unknown>)) {
      if (typeof usd === "number" && usd >= SEAT_MIN && usd <= SEAT_MAX) seats[id] = usd;
    }
  }
  return {
    defaultSeatUsd: num(v.defaultSeatUsd, DEFAULT_SETTINGS.defaultSeatUsd, SEAT_MIN, SEAT_MAX),
    seats,
    multiplier: num(v.multiplier, DEFAULT_SETTINGS.multiplier, MULTIPLIER_MIN, MULTIPLIER_MAX),
    alertsLive: v.alertsLive === true,
  };
}

export async function claudeUsageSettings(): Promise<ClaudeUsageSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: CLAUDE_USAGE_SETTINGS_KEY } });
  return readSettings(row?.value);
}

export type SettingsInput = {
  defaultSeatUsd?: number;
  multiplier?: number;
  /// userId → seat. null puts the person back on the default seat.
  seats?: Record<string, number | null>;
};

export async function updateClaudeUsageSettings(actor: User, input: SettingsInput): Promise<ClaudeUsageSettings> {
  assertCanView(actor);
  const before = await claudeUsageSettings();
  // Each refusal is written out, not built by a helper: the codes must be
  // string literals so tests/unit/i18n-domain-errors.test.ts can check them.
  const seatOk = (x: number) => Number.isFinite(x) && x >= SEAT_MIN && x <= SEAT_MAX;
  const seatRefusal = () =>
    new DomainError("claudeUsage.seatRange", `מחיר מושב הוא בין ${SEAT_MIN} ל-${SEAT_MAX} דולר.`, { min: SEAT_MIN, max: SEAT_MAX });
  if (input.defaultSeatUsd !== undefined && !seatOk(input.defaultSeatUsd)) throw seatRefusal();
  if (input.multiplier !== undefined && !(Number.isFinite(input.multiplier) && input.multiplier >= MULTIPLIER_MIN && input.multiplier <= MULTIPLIER_MAX)) {
    throw new DomainError("claudeUsage.multiplierRange", `המכפיל הוא בין ${MULTIPLIER_MIN} ל-${MULTIPLIER_MAX}.`, { min: MULTIPLIER_MIN, max: MULTIPLIER_MAX });
  }
  const seats = { ...before.seats };
  for (const [id, usd] of Object.entries(input.seats ?? {})) {
    if (usd === null) delete seats[id];
    else if (!seatOk(usd)) throw seatRefusal();
    else seats[id] = usd;
  }
  const after: ClaudeUsageSettings = {
    ...before,
    defaultSeatUsd: input.defaultSeatUsd ?? before.defaultSeatUsd,
    multiplier: input.multiplier ?? before.multiplier,
    seats,
  };
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
  seatUsd: number;
  cowork: {
    requests: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /// Share of input that came from the cache: the higher, the cheaper.
    cacheSharePct: number | null;
    models: { model: string; requests: number; costUsd: number }[];
    limitHits: number;
    heaviestWindow: { start: string; costUsd: number; tokens: number; requests: number; limitHits: number } | null;
    lastEventAt: string | null;
  };
  connector: { calls: number; bytes: number; images: number; failures: number };
  prompts: { copies: number; chars: number };
  month: { costUsd: number; thresholdUsd: number; projectedUsd: number; status: SeatStatus };
  /// Uses the connector in the period but nothing arrived from Cowork:
  /// probably an old desktop app, or Cowork not used at all.
  noTelemetry: boolean;
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
  people: PersonUsage[];
  tools: ToolUsage[];
  prompts: { kind: PromptKind; copies: number; avgChars: number; maxChars: number }[];
  signals: { briefThenFile: number; duplicateReads: number; truncatedAnswers: number; limitHits: number };
  heaviestRequests: { promptId: string; name: string; at: string; costUsd: number; requests: number; models: string[]; ankoraTools: string[] }[];
  coverage: { coworkEvents: number; toolCalls: number; promptCopies: number; unmatchedEmails: string[] };
};

const isReadOnly = (tool: string) => (TOOL_ANNOTATIONS as Record<string, { readOnlyHint?: boolean }>)[tool]?.readOnlyHint === true;

/// The first day of this month in Ankora's timezone.
function monthStart(now: Date): { start: Date; dayOfMonth: number; daysInMonth: number } {
  const [y, m, d] = localDateKey(now).split("-").map(Number);
  const start = dayStartInZone(`${y}-${String(m).padStart(2, "0")}-01`)!;
  return { start, dayOfMonth: d, daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

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
}): CoworkEventIn {
  return { ...r, costUsd: r.costUsd === null ? null : Number(r.costUsd) };
}

export async function getClaudeUsageReport(actor: User, opts: { days?: number; now?: Date } = {}): Promise<ClaudeUsageReport> {
  assertCanView(actor);
  const now = opts.now ?? new Date();
  const days: UsagePeriod = opts.days === 30 ? 30 : 7;
  const from = new Date(now.getTime() - days * 86_400_000);
  const month = monthStart(now);
  const settings = await claudeUsageSettings();

  const [users, calls, events, copies, monthCosts, unmatched] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.mcpToolCall.findMany({ where: { createdAt: { gte: from, lte: now } } }),
    prisma.coworkEvent.findMany({
      where: { occurredAt: { gte: from, lte: now } },
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
      },
    }),
    prisma.claudePromptCopy.findMany({ where: { createdAt: { gte: from, lte: now } } }),
    prisma.coworkEvent.groupBy({
      by: ["userId"],
      where: { eventName: "api_request", occurredAt: { gte: month.start, lte: now } },
      _sum: { costUsd: true },
    }),
    prisma.coworkEvent.findMany({
      where: { userId: null, userEmail: { not: null }, occurredAt: { gte: from, lte: now } },
      distinct: ["userEmail"],
      select: { userEmail: true },
      take: 20,
    }),
  ]);

  const coworkIn = events.map(toCoworkIn);
  const callIn: ToolCallIn[] = calls;
  const byUser = <T extends { userId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.userId) m.set(r.userId, [...(m.get(r.userId) ?? []), r]);
    return m;
  };
  const callsBy = byUser(callIn);
  const eventsBy = byUser(coworkIn);
  const copiesBy = byUser(copies);
  const monthBy = new Map(monthCosts.map((m) => [m.userId, Number(m._sum.costUsd ?? 0)]));

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
    const seatUsd = settings.seats[u.id] ?? settings.defaultSeatUsd;
    const monthCost = round2(monthBy.get(u.id) ?? 0);
    const seat = seatStatus({ monthCostUsd: monthCost, seatUsd, multiplier: settings.multiplier, dayOfMonth: month.dayOfMonth, daysInMonth: month.daysInMonth });
    const last = ev.reduce<Date | null>((d, e) => (!d || e.occurredAt > d ? e.occurredAt : d), null);
    const allInput = input + cacheRead + cacheCreation;
    return {
      userId: u.id,
      name: u.name,
      seatUsd,
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
      month: { costUsd: monthCost, ...seat },
      noTelemetry: userCalls.length > 0 && ev.length === 0,
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

  return {
    period: { days, from: from.toISOString(), to: now.toISOString() },
    settings,
    people,
    tools,
    prompts,
    signals: {
      briefThenFile: briefThenFile(callIn),
      duplicateReads: [...dups.values()].reduce((n, d) => n + d, 0),
      truncatedAnswers: callIn.filter((c) => c.truncated).length,
      limitHits: coworkIn.filter(isLimitHit).length,
    },
    heaviestRequests,
    coverage: {
      coworkEvents: events.length,
      toolCalls: calls.length,
      promptCopies: copies.length,
      unmatchedEmails: unmatched.map((u) => u.userEmail!).filter(Boolean),
    },
  };
}
