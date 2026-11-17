import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ToolCallMeasure } from "@/lib/claude-usage/measure";
import { isPromptKind, MAX_PROMPT_CHARS } from "@/lib/claude-usage/prompt-kinds";

// Claude usage measurement (17.11.2026): the half that writes. See
// lib/claude-usage/measure.ts for what is measured and why, and
// prisma/schema.prisma (McpToolCall, ClaudePromptCopy) for what is kept.

/// Runs `fn` after the response, so a tool's answer and a copy never wait
/// on this write. Outside a request (a test, a script) there is no
/// response to wait for, and it runs now. A failure is logged and dropped:
/// a lost measurement is not worth an error anyone sees.
function afterResponse(label: string, fn: () => Promise<unknown>): Promise<void> {
  const guarded = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[claude-usage] could not record ${label}`, err);
    }
  };
  try {
    after(guarded);
    return Promise.resolve();
  } catch {
    return guarded();
  }
}

export function recordToolCall(m: ToolCallMeasure): Promise<void> {
  return afterResponse(`a call to ${m.tool}`, () => prisma.mcpToolCall.create({ data: m }));
}

export function recordPromptCopy(userId: string, kind: unknown, chars: unknown): Promise<void> {
  if (!isPromptKind(kind)) return Promise.resolve();
  const n = typeof chars === "number" && Number.isFinite(chars) ? Math.min(MAX_PROMPT_CHARS, Math.max(0, Math.round(chars))) : 0;
  return afterResponse(`a ${kind} prompt copy`, () => prisma.claudePromptCopy.create({ data: { userId, kind, chars: n } }));
}

/// Days a measurement is kept. Long enough to compare a month before a
/// change with a month after it; short enough that the tables stay small.
export const CLAUDE_USAGE_RETENTION_DAYS = 90;

export async function pruneClaudeUsage(now: Date = new Date()): Promise<{ toolCalls: number; promptCopies: number }> {
  const before = new Date(now.getTime() - CLAUDE_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [toolCalls, promptCopies] = await prisma.$transaction([
    prisma.mcpToolCall.deleteMany({ where: { createdAt: { lt: before } } }),
    prisma.claudePromptCopy.deleteMany({ where: { createdAt: { lt: before } } }),
  ]);
  return { toolCalls: toolCalls.count, promptCopies: promptCopies.count };
}
