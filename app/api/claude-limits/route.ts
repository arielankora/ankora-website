import { authorizeLimitsRequest } from "@/lib/claude-usage/limits-auth";
import { parseLimitReading } from "@/lib/claude-usage/limits";
import { ingestLimitReading } from "@/lib/claude-usage/cowork-ingest";
import { rateLimitResponse } from "@/lib/rate-limit";

// Claude usage measurement, way 3 (17.11.2026): where the Ankora browser
// extension (tools/claude-limits-extension) posts each person's five-hour
// and weekly limit percentages, every 15 minutes. A public URL, gated by
// CLAUDE_LIMITS_SECRET, which reaches the extension through a Chrome policy
// rather than its code. A reading is two percentages, two reset times and an
// email; nothing else is read from the body.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// A reading is a few hundred bytes.
const MAX_BODY_BYTES = 8 * 1024;
/// Per IP. The office shares one: 4 readings an hour per person.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimitResponse(request.headers, "claude-limits", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  const auth = authorizeLimitsRequest(request);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return json(413, { error: "Body too large" });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "Body is not JSON" });
  }

  const parsed = parseLimitReading(body);
  if (!parsed.ok) return json(400, { error: parsed.error });

  try {
    const { matched } = await ingestLimitReading(parsed.reading);
    return json(200, { ok: true, matched });
  } catch (err) {
    console.error("[claude-limits] could not store a reading", err);
    return json(503, { error: "Could not store the reading. Try again later." });
  }
}
