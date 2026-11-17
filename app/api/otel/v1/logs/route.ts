import { gunzipSync } from "zlib";
import { authorizeOtelRequest } from "@/lib/claude-usage/otel-auth";
import { parseOtlpLogs } from "@/lib/claude-usage/otlp";
import { ingestCoworkEvents } from "@/lib/claude-usage/cowork-ingest";
import { rateLimitResponse } from "@/lib/rate-limit";

// Claude usage measurement, stage 2 (17.11.2026): where Cowork's telemetry
// lands. In claude.ai, Organization settings > Data and privacy >
// Monitoring, the "Cowork" item points here:
//
//   OTLP endpoint:  https://www.ankora.co.il/api/otel
//   OTLP protocol:  http/json
//   OTLP headers:   Authorization=Bearer <COWORK_OTEL_SECRET>
//
// The exporter adds /v1/logs to the endpoint itself, which is this route.
//
// Claude Code sends here too (17.11.2026), with its own secret
// (CLAUDE_CODE_OTEL_SECRET) set through its managed settings: its events
// have the same names and attributes, and service.name "claude-code".
// It runs on each employee's computer, so this is a public URL: the shared
// secret is the gate, and the body is read with a size cap before
// anything parses it. What is kept is metadata only; see
// lib/claude-usage/otlp.ts.
//
// Answers follow OTLP/HTTP: 200 with `partialSuccess` when the batch was
// taken (a record that could not be read is reported as rejected, not
// retried), 400 for a body that is not OTLP/JSON (retrying will not fix
// it), 503 when storing failed (the exporter tries again later).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// The exporter batches events; a few hundred kilobytes is a big batch.
/// Over this, the request is not telemetry.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/// A gzip body is checked again after it is unpacked.
const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;

/// Per IP. The office shares one, and each running Cowork session exports
/// every few seconds, so this is set well above a busy day.
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request): Promise<Buffer | "too_large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "too_large";
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimitResponse(request.headers, "otel", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  const auth = authorizeOtelRequest(request);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("application/json")) {
    return json(415, { error: "Only OTLP/JSON is accepted here. Set the OTLP protocol to http/json." });
  }

  const raw = await readBody(request);
  if (raw === "too_large") return json(413, { error: "Body too large" });

  let text: string;
  try {
    const encoding = (request.headers.get("content-encoding") ?? "").toLowerCase();
    const bytes = encoding === "gzip" ? gunzipSync(raw, { maxOutputLength: MAX_UNPACKED_BYTES }) : raw;
    text = bytes.toString("utf8");
  } catch {
    return json(400, { error: "Body could not be unpacked" });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "Body is not JSON" });
  }

  const { rows, skipped } = parseOtlpLogs(body);
  try {
    await ingestCoworkEvents(rows);
  } catch (err) {
    console.error("[otel] could not store Cowork events", err);
    return json(503, { error: "Could not store the events. Try again later." });
  }

  return json(200, {
    partialSuccess: skipped > 0 ? { rejectedLogRecords: String(skipped), errorMessage: "Records without a known event name or time were skipped." } : {},
  });
}
