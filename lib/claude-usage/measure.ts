import { createHash } from "crypto";
import { toolCallContext } from "@/lib/mcp/tool-context";

// Claude usage measurement (17.11.2026): the pure half of the MCP call log.
//
// Ankora wants to know how much of each employee's Claude allowance the app
// itself causes, so it can shrink the tools and prompts that cost the most
// and keep people out of the five-hour window. Cowork's telemetry only sees
// the desktop app; this log sees every call to the connector, from the
// browser and the phone too, because it is written on our side.
//
// This file has no Prisma and no Next imports, so tests/unit can load it.
// lib/claude-usage/record.ts is the half that writes the row.
//
// What is kept is deliberately thin: sizes, timings, a success flag, and a
// short hash of the arguments. Never an argument and never a result. The
// hash exists for one question: did Claude make the same call twice in the
// same conversation? Equal hashes from one user minutes apart say yes.

export type ToolCallMeasure = {
  userId: string | null;
  tool: string;
  ok: boolean;
  resultBytes: number;
  resultChars: number;
  imageCount: number;
  truncated: boolean;
  argsHash: string;
  durationMs: number;
};

/// Called once per call. Not awaited: whatever it returns, the answer goes
/// back to Claude without waiting for it.
export type ToolCallSink = (measure: ToolCallMeasure) => unknown;

type ContentPart = { type?: string; text?: unknown; data?: unknown };
type ToolResult = { content?: ContentPart[]; isError?: boolean } | undefined;

/// Matches the flag our tools set when they cut an answer short
/// (read_document, list_my_time_entries). Pretty-printed or compact.
const TRUNCATED = /"truncated"\s*:\s*true/;

/// What one tool result cost to send back to Claude.
export function measureResult(result: ToolResult): Pick<ToolCallMeasure, "ok" | "resultBytes" | "resultChars" | "imageCount" | "truncated"> {
  let resultBytes = 0;
  let resultChars = 0;
  let imageCount = 0;
  let truncated = false;
  for (const part of result?.content ?? []) {
    if (typeof part.text === "string") {
      resultBytes += Buffer.byteLength(part.text, "utf8");
      resultChars += part.text.length;
      if (!truncated && TRUNCATED.test(part.text)) truncated = true;
    } else if (part.type === "image" && typeof part.data === "string") {
      imageCount += 1;
      // Base64 carries 3 bytes in every 4 characters; padding is noise here.
      resultBytes += Math.floor((part.data.length * 3) / 4);
    }
  }
  return { ok: result?.isError !== true, resultBytes, resultChars, imageCount, truncated };
}

/// A stable JSON: object keys sorted at every depth, so {a,b} and {b,a}
/// hash the same.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}

export function argsHash(args: unknown): string {
  const json = JSON.stringify(stable(args ?? {})) ?? "null";
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

type Ctx = { http?: { authInfo?: { extra?: { user?: { id?: unknown } } } } };

function userIdOf(ctx: unknown): string | null {
  const id = (ctx as Ctx | undefined)?.http?.authInfo?.extra?.user?.id;
  return typeof id === "string" ? id : null;
}

type Handler = (args: unknown, ctx: unknown) => unknown;
/// Anything with a registerTool: the SDK's McpServer, or a test's stand-in.
/// Typed loosely on purpose, since the SDK's own signature is generic over
/// each tool's schema; the wrapper only passes the arguments through.
type Registrar = { registerTool: (...args: never[]) => unknown };
type LooseRegister = (name: string, config: unknown, handler: Handler) => unknown;

/// Returns a stand-in for the MCP server whose registerTool wraps every
/// handler with a measurement. Every tool, present and future, is measured
/// without being touched: the registration modules only ever call
/// `server.registerTool` (82 of them on 17.11.2026, nothing else).
///
/// The wrapper never changes what a tool returns and never throws because
/// of the measurement: a sink that fails is swallowed. A handler that
/// throws (they all catch their own errors, so this is a bug) is measured
/// as a failure and rethrown untouched.
/// `onUnexpected` (27.11.2026): a handler whose error was not one the
/// domain meant (toMcpToolError's fallback) is reported once it is done,
/// with the tool's name. It never changes the result and never throws.
export function withToolMeasurement<S extends Registrar>(
  server: S,
  sink: ToolCallSink,
  now: () => number = Date.now,
  onUnexpected?: (tool: string, err: unknown) => Promise<void>,
): S {
  const register = (server.registerTool as unknown as LooseRegister).bind(server);
  const registerTool = (name: string, config: unknown, handler: Handler) =>
    register(name, config, async (args: unknown, ctx: unknown) => {
      const started = now();
      let result: ToolResult;
      let threw = false;
      const call: { tool: string; unexpected?: unknown } = { tool: name };
      try {
        result = (await toolCallContext.run(call, () => handler(args, ctx))) as ToolResult;
        if (call.unexpected !== undefined && onUnexpected) {
          try {
            await onUnexpected(name, call.unexpected);
          } catch {
            // Reporting must never cost the user their answer.
          }
        }
        return result;
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        try {
          const measured = measureResult(result);
          void sink({
            userId: userIdOf(ctx),
            tool: name,
            ...measured,
            ok: threw ? false : measured.ok,
            argsHash: argsHash(args),
            durationMs: Math.max(0, Math.round(now() - started)),
          });
        } catch {
          // A measurement must never cost the user their answer.
        }
      }
    });
  return new Proxy(server, {
    get(target, prop) {
      if (prop === "registerTool") return registerTool;
      // Bound to the real server, so a method that relies on its own
      // private state keeps working through the stand-in.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
