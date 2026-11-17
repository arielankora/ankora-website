import { createHash } from "crypto";

// Claude usage measurement, stage 2 (17.11.2026): reading what Cowork sends.
//
// Cowork exports one OpenTelemetry log record per event (a prompt, an API
// request, a tool result) to the address set in claude.ai under
// Organization settings > Data and privacy > Monitoring. That address is
// /api/otel/v1/logs here, and this file turns its OTLP/JSON body into rows
// for cowork_events. Pure: no Prisma, no Next, so tests/unit can load it.
//
// The rule that shapes everything below: keep metadata, never content.
// Employees agreed to usage being measured, not to their prompts being
// stored. Current Cowork sends metadata only unless a device is told
// otherwise, but older desktop versions send the prompt text, the model's
// answer and tool inputs by default. So nothing is copied by default: each
// field below is read by name from an allowlist, and an attribute that is
// not on it (prompt, response, tool_input, workspace.host_paths, and any
// added in a later version) is never read at all.
//
// Event reference: https://claude.com/docs/cowork/monitoring

/// The events worth a row. user_prompt counts prompts (its length only);
/// api_request carries tokens, cost and model; api_error is where a person
/// hitting their limit shows up; tool_result is what a tool sent back.
export const KEPT_EVENTS = ["user_prompt", "api_request", "api_error", "tool_result"] as const;
export type KeptEvent = (typeof KEPT_EVENTS)[number];

export type CoworkEventRow = {
  dedupeKey: string;
  eventName: KeptEvent;
  /// Lower-cased, for matching to an Ankora user. Present on first-party
  /// deployments, which is what Ankora's Team workspace is.
  userEmail: string | null;
  accountUuid: string | null;
  sessionId: string | null;
  promptId: string | null;
  occurredAt: Date;
  source: string | null;
  appVersion: string | null;
  model: string | null;
  /// Estimated USD, as Cowork computes it. Kept as a string for Decimal.
  costUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  durationMs: number | null;
  speed: string | null;
  statusCode: string | null;
  attempt: number | null;
  /// api_error only, cut to ERROR_TEXT_MAX. An API error says why the
  /// request failed ("rate_limit_error: ..."), which is the signal for a
  /// person stuck in the five-hour window. A tool's error can quote the
  /// tool's input, so it is never kept.
  errorText: string | null;
  toolName: string | null;
  toolSuccess: boolean | null;
  toolResultBytes: number | null;
  mcpServer: string | null;
  mcpTool: string | null;
  promptLength: number | null;
};

export const ERROR_TEXT_MAX = 300;

type AnyValue = {
  stringValue?: unknown;
  intValue?: unknown;
  doubleValue?: unknown;
  boolValue?: unknown;
};
type KeyValue = { key?: unknown; value?: AnyValue };
type LogRecord = { timeUnixNano?: unknown; observedTimeUnixNano?: unknown; body?: AnyValue; attributes?: KeyValue[] };
type OtlpLogs = {
  resourceLogs?: { resource?: { attributes?: KeyValue[] }; scopeLogs?: { logRecords?: LogRecord[] }[] }[];
};

/// Reads attributes into a map of plain values. Only scalar values: an
/// array or a nested map is never content we want (host paths are arrays).
function attrs(list: KeyValue[] | undefined): Map<string, string | number | boolean> {
  const out = new Map<string, string | number | boolean>();
  if (!Array.isArray(list)) return out;
  for (const kv of list) {
    if (typeof kv?.key !== "string" || !kv.value) continue;
    const v = kv.value;
    if (typeof v.stringValue === "string") out.set(kv.key, v.stringValue);
    else if (typeof v.boolValue === "boolean") out.set(kv.key, v.boolValue);
    else if (typeof v.doubleValue === "number") out.set(kv.key, v.doubleValue);
    // OTLP/JSON writes 64-bit integers as strings.
    else if (typeof v.intValue === "number" || typeof v.intValue === "string") out.set(kv.key, String(v.intValue));
  }
  return out;
}

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : typeof v === "number" ? String(v) : null);

function int(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  // Int columns. A value past this is not a real count.
  return r >= 0 && r <= 2_147_483_647 ? r : null;
}

function decimal(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return n.toFixed(6);
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/// "api_request", "cowork.api_request" and "claude_code.api_request" are
/// the same event: the name is whatever follows the last dot.
function eventNameOf(a: Map<string, unknown>, body: AnyValue | undefined): KeptEvent | null {
  const raw = (typeof a.get("event.name") === "string" ? a.get("event.name") : body?.stringValue) as string | undefined;
  if (typeof raw !== "string") return null;
  const name = raw.slice(raw.lastIndexOf(".") + 1);
  return (KEPT_EVENTS as readonly string[]).includes(name) ? (name as KeptEvent) : null;
}

function occurredAtOf(a: Map<string, unknown>, rec: LogRecord): Date | null {
  const iso = a.get("event.timestamp");
  if (typeof iso === "string") {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  for (const nano of [rec.timeUnixNano, rec.observedTimeUnixNano]) {
    if (typeof nano === "string" || typeof nano === "number") {
      const ms = Number(BigInt(String(nano).split(".")[0] || "0") / BigInt(1_000_000));
      if (ms > 0) return new Date(ms);
    }
  }
  return null;
}

/// tool_parameters is a JSON string. Only the two names are read from it,
/// and only when Cowork sent them (they need toolDetails on the device).
function mcpNames(raw: unknown): { mcpServer: string | null; mcpTool: string | null } {
  if (typeof raw !== "string" || raw.length > 20_000) return { mcpServer: null, mcpTool: null };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return { mcpServer: str(p?.mcp_server_name, 100), mcpTool: str(p?.mcp_tool_name, 100) };
  } catch {
    return { mcpServer: null, mcpTool: null };
  }
}

function dedupeKeyOf(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("\u0000")).digest("hex").slice(0, 32);
}

export type ParseResult = { rows: CoworkEventRow[]; skipped: number };

/// Turns one OTLP/JSON export request into rows. Never throws on a strange
/// record: it is counted as skipped, so one bad event does not lose the
/// batch (and the exporter does not retry it forever).
export function parseOtlpLogs(body: unknown): ParseResult {
  const rows: CoworkEventRow[] = [];
  let skipped = 0;
  const resourceLogs = (body as OtlpLogs | null)?.resourceLogs;
  if (!Array.isArray(resourceLogs)) return { rows, skipped };

  for (const rl of resourceLogs) {
    const res = attrs(rl?.resource?.attributes);
    for (const sl of Array.isArray(rl?.scopeLogs) ? rl.scopeLogs : []) {
      for (const rec of Array.isArray(sl?.logRecords) ? sl.logRecords : []) {
        try {
          const a = attrs(rec?.attributes);
          const eventName = eventNameOf(a, rec?.body);
          const occurredAt = occurredAtOf(a, rec);
          if (!eventName || !occurredAt) {
            skipped += 1;
            continue;
          }
          const email = str(a.get("user.email"), 320);
          const isTool = eventName === "tool_result";
          const row: CoworkEventRow = {
            dedupeKey: "",
            eventName,
            userEmail: email ? email.toLowerCase() : null,
            accountUuid: str(a.get("user.account_uuid"), 64),
            sessionId: str(a.get("session.id"), 100),
            promptId: str(a.get("prompt.id"), 100),
            occurredAt,
            source: str(res.get("service.name"), 50),
            appVersion: str(res.get("service.version"), 50),
            model: str(a.get("model"), 100),
            costUsd: eventName === "api_request" ? decimal(a.get("cost_usd")) : null,
            inputTokens: int(a.get("input_tokens")),
            outputTokens: int(a.get("output_tokens")),
            cacheReadTokens: int(a.get("cache_read_tokens")),
            cacheCreationTokens: int(a.get("cache_creation_tokens")),
            durationMs: int(a.get("duration_ms")),
            speed: str(a.get("speed"), 20),
            statusCode: eventName === "api_error" ? str(a.get("status_code"), 20) : null,
            attempt: eventName === "api_error" ? int(a.get("attempt")) : null,
            errorText: eventName === "api_error" ? str(a.get("error"), ERROR_TEXT_MAX) : null,
            toolName: isTool ? str(a.get("tool_name"), 100) : null,
            toolSuccess: isTool ? bool(a.get("success")) : null,
            toolResultBytes: isTool ? int(a.get("tool_result_size_bytes")) : null,
            ...(isTool ? mcpNames(a.get("tool_parameters")) : { mcpServer: null, mcpTool: null }),
            promptLength: eventName === "user_prompt" ? int(a.get("prompt_length")) : null,
          };
          // The exporter retries a batch it thinks failed. The same event
          // sent twice must land once.
          row.dedupeKey = dedupeKeyOf([
            row.sessionId,
            eventName,
            occurredAt.toISOString(),
            str(a.get("event.sequence")),
            str(a.get("tool_use_id")) ?? str(a.get("request_id")),
            row.promptId,
            row.accountUuid ?? row.userEmail,
          ]);
          rows.push(row);
        } catch {
          skipped += 1;
        }
      }
    }
  }
  return { rows, skipped };
}
