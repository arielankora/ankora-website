// Demo data for the "שימוש בקלוד" screen (/app/claude-usage), shared by
// the guide seeds (scripts/seed-guide-he.ts, scripts/seed-guide-en.ts).
//
// The screen reads four tables that only real traffic fills: calls to the
// Ankora connector (McpToolCall), prompts copied from the app
// (ClaudePromptCopy), telemetry from Cowork and Claude Code (CoworkEvent)
// and quota readings from the Chrome extension (ClaudeLimitSample). This
// writes a week of each for the people given, with fixed randomness and
// times relative to now, so every block of the screen has something in it:
// one person stuck now, one at risk before the reset, one calm, a limit hit
// earlier in the week, a heavy tool, repeated reads and copied prompts.
// No prompt text is written, as in the real tables.

import type { PrismaClient, Prisma } from "@prisma/client";

export type UsagePerson = { id: string; email: string };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const TOOLS: { name: string; bytes: number; readOnly: boolean }[] = [
  { name: "get_client_file", bytes: 46_000, readOnly: true },
  { name: "get_client_brief", bytes: 9_000, readOnly: true },
  { name: "get_task", bytes: 6_500, readOnly: true },
  { name: "list_tasks", bytes: 12_000, readOnly: true },
  { name: "get_process", bytes: 15_000, readOnly: true },
  { name: "list_my_time_entries", bytes: 4_000, readOnly: true },
  { name: "start_timer", bytes: 700, readOnly: false },
  { name: "add_task_comment", bytes: 500, readOnly: false },
  { name: "propose_knowledge", bytes: 1_200, readOnly: false },
];

const PROMPT_KINDS = ["advance_plan", "advance_lessons", "extract", "translation", "client_activity"];
const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];

/// `people` in the order the screen should tell their story: the first is
/// stuck now, the second is at risk, the rest are calm. Needs at least
/// three. Only the first four are used.
export async function seedClaudeUsage(prisma: PrismaClient, people: UsagePerson[], now: Date = new Date()) {
  if (people.length < 3) throw new Error("seedClaudeUsage needs at least three people");
  const rand = mulberry32(20261122);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const crew = people.slice(0, 4);

  const calls: Prisma.McpToolCallCreateManyInput[] = [];
  const copies: Prisma.ClaudePromptCopyCreateManyInput[] = [];
  const events: Prisma.CoworkEventCreateManyInput[] = [];
  const samples: Prisma.ClaudeLimitSampleCreateManyInput[] = [];
  let seq = 0;

  for (const [i, p] of crew.entries()) {
    // Heavier use for the first two people.
    const perDay = i === 0 ? 14 : i === 1 ? 11 : 6;
    const source = i === 2 ? "claude-code" : "cowork";
    for (let d = 6; d >= 0; d--) {
      const dayStart = now.getTime() - d * DAY;
      for (let n = 0; n < perDay; n++) {
        // Working hours, earlier than now on the current day.
        const t = new Date(Math.min(dayStart - (9 * HOUR) * rand(), now.getTime() - (n + 1) * 7 * MIN));
        const promptId = `demo-prompt-${++seq}`;
        events.push({
          dedupeKey: `demo-${seq}-prompt`,
          eventName: "user_prompt",
          userId: p.id,
          userEmail: p.email,
          sessionId: `demo-session-${i}-${d}`,
          promptId,
          occurredAt: t,
          source,
          appVersion: "1.4.0",
          promptLength: 200 + Math.floor(rand() * 1800),
        });
        const requests = 2 + Math.floor(rand() * 4);
        for (let r = 0; r < requests; r++) {
          const at = new Date(t.getTime() + (r + 1) * 20_000);
          const input = 8_000 + Math.floor(rand() * 40_000);
          const cached = Math.floor(input * (0.4 + rand() * 0.5));
          events.push({
            dedupeKey: `demo-${seq}-req-${r}`,
            eventName: "api_request",
            userId: p.id,
            userEmail: p.email,
            sessionId: `demo-session-${i}-${d}`,
            promptId,
            occurredAt: at,
            source,
            appVersion: "1.4.0",
            model: pick(MODELS),
            costUsd: (input / 1_000_000) * 5 + rand() * 0.2,
            inputTokens: input - cached,
            outputTokens: 400 + Math.floor(rand() * 3000),
            cacheReadTokens: cached,
            cacheCreationTokens: Math.floor(rand() * 4000),
            durationMs: 3000 + Math.floor(rand() * 20000),
            statusCode: "200",
            attempt: 1,
          });
          if (rand() < 0.6) {
            const tool = pick(TOOLS);
            const bytes = Math.round(tool.bytes * (0.7 + rand() * 0.6));
            events.push({
              dedupeKey: `demo-${seq}-tool-${r}`,
              eventName: "tool_result",
              userId: p.id,
              userEmail: p.email,
              sessionId: `demo-session-${i}-${d}`,
              promptId,
              occurredAt: new Date(at.getTime() + 5_000),
              source,
              toolName: "mcp_tool",
              toolSuccess: true,
              toolResultBytes: bytes,
              mcpServer: "ankora",
              mcpTool: tool.name,
            });
            calls.push({
              userId: p.id,
              tool: tool.name,
              ok: rand() > 0.03,
              resultBytes: bytes,
              resultChars: Math.round(bytes * 0.55),
              imageCount: 0,
              truncated: tool.name === "get_client_file" && rand() < 0.15,
              // The same read twice within minutes counts as a repeated read.
              argsHash: tool.readOnly && rand() < 0.25 ? `demo-repeat-${i}-${tool.name}` : `demo-${seq}-${r}`,
              durationMs: 80 + Math.floor(rand() * 900),
              createdAt: new Date(at.getTime() + 4_000),
            });
          }
        }
      }
      if (rand() < 0.7) {
        copies.push({ userId: p.id, kind: pick(PROMPT_KINDS), chars: 900 + Math.floor(rand() * 5000), createdAt: new Date(dayStart - 3 * HOUR * rand()) });
      }
    }
  }

  // A limit hit earlier in the week, for the second person.
  events.push({
    dedupeKey: "demo-limit-hit-1",
    eventName: "api_error",
    userId: crew[1].id,
    userEmail: crew[1].email,
    occurredAt: new Date(now.getTime() - 3 * DAY - 2 * HOUR),
    source: "cowork",
    statusCode: "429",
    errorText: "usage limit reached",
    attempt: 1,
  });
  // And one now, for the first person, who is stuck.
  events.push({
    dedupeKey: "demo-limit-hit-2",
    eventName: "api_error",
    userId: crew[0].id,
    userEmail: crew[0].email,
    occurredAt: new Date(now.getTime() - 20 * MIN),
    source: "cowork",
    statusCode: "429",
    errorText: "usage limit reached",
    attempt: 1,
  });

  // Fresh quota readings from the extension (within the last hour), one
  // story per person: stuck, at risk, calm, calm.
  const readings = [
    { five: 100, fiveLeft: 95 * MIN, week: 71, weekLeft: 2.5 * DAY },
    { five: 78, fiveLeft: 3.5 * HOUR, week: 64, weekLeft: 2.5 * DAY },
    { five: 22, fiveLeft: 2 * HOUR, week: 31, weekLeft: 4 * DAY },
    { five: 9, fiveLeft: 4 * HOUR, week: 18, weekLeft: 5 * DAY },
  ];
  for (const [i, p] of crew.entries()) {
    const r = readings[i];
    for (const ago of [50, 25, 6]) {
      const scale = ago === 6 ? 1 : 1 - ago / 200;
      samples.push({
        userId: p.id,
        email: p.email,
        fiveHourPct: Math.round(r.five * scale),
        fiveHourResetsAt: new Date(now.getTime() + r.fiveLeft),
        sevenDayPct: Math.round(r.week * scale),
        sevenDayResetsAt: new Date(now.getTime() + r.weekLeft),
        observedAt: new Date(now.getTime() - ago * MIN),
        extensionVersion: "0.3.0",
      });
    }
  }

  await prisma.coworkEvent.createMany({ data: events });
  await prisma.mcpToolCall.createMany({ data: calls });
  await prisma.claudePromptCopy.createMany({ data: copies });
  await prisma.claudeLimitSample.createMany({ data: samples });
  return { events: events.length, calls: calls.length, copies: copies.length, samples: samples.length };
}
