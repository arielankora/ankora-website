import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "zlib";
import { coworkExport, SECRET_PROMPT } from "./otlp-fixture";

// Claude usage measurement, stage 2 (17.11.2026): /api/otel/v1/logs is a
// public URL that Cowork posts to from every employee's computer. It must
// refuse anyone without the shared secret before reading the body, keep
// to OTLP/JSON, cap the body, and answer the way an OTLP exporter expects
// so nothing is retried forever and nothing is lost on a database hiccup.

const ingest = vi.hoisted(() => ({ ingestCoworkEvents: vi.fn(async (_rows: unknown[]) => ({ stored: 0, duplicates: 0 })) }));
vi.mock("@/lib/claude-usage/cowork-ingest", () => ingest);
vi.mock("@/lib/rate-limit", () => ({ rateLimitResponse: vi.fn(async () => null) }));

const route = await import("@/app/api/otel/v1/logs/route");

const SECRET = "otel-secret-0123456789abcdef";
const ORIGINAL = process.env.COWORK_OTEL_SECRET;
const ORIGINAL_CODE = process.env.CLAUDE_CODE_OTEL_SECRET;
const CODE_SECRET = "claude-code-secret-0123456789abcdef";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("https://ankora.test/api/otel/v1/logs", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json", ...headers },
    body,
  });
}

describe("POST /api/otel/v1/logs", () => {
  beforeEach(() => {
    process.env.COWORK_OTEL_SECRET = SECRET;
    delete process.env.CLAUDE_CODE_OTEL_SECRET;
    ingest.ingestCoworkEvents.mockClear();
  });
  afterEach(() => {
    process.env.COWORK_OTEL_SECRET = ORIGINAL;
    if (ORIGINAL_CODE === undefined) delete process.env.CLAUDE_CODE_OTEL_SECRET;
    else process.env.CLAUDE_CODE_OTEL_SECRET = ORIGINAL_CODE;
  });

  it("lets Claude Code in with its own secret, and Cowork's keeps working beside it", async () => {
    process.env.CLAUDE_CODE_OTEL_SECRET = CODE_SECRET;
    const claudeCode = {
      resourceLogs: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: "1763366400000000000",
                  body: { stringValue: "claude_code.api_request" },
                  attributes: [
                    { key: "event.name", value: { stringValue: "api_request" } },
                    { key: "user.email", value: { stringValue: "ops@ankora.co.il" } },
                    { key: "model", value: { stringValue: "claude-opus-5-5" } },
                    { key: "cost_usd", value: { doubleValue: 0.2 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await route.POST(post(JSON.stringify(claudeCode), { authorization: `Bearer ${CODE_SECRET}` }));
    expect(res.status).toBe(200);
    expect(ingest.ingestCoworkEvents.mock.calls[0][0]).toEqual([
      expect.objectContaining({ eventName: "api_request", source: "claude-code", userEmail: "ops@ankora.co.il", costUsd: "0.200000" }),
    ]);
    expect((await route.POST(post(JSON.stringify(claudeCode)))).status).toBe(200);
  });

  it("works with only the Claude Code secret set", async () => {
    delete process.env.COWORK_OTEL_SECRET;
    process.env.CLAUDE_CODE_OTEL_SECRET = CODE_SECRET;
    expect((await route.POST(post("{}", { authorization: `Bearer ${CODE_SECRET}` }))).status).toBe(200);
    expect((await route.POST(post("{}"))).status).toBe(401);
  });

  it("refuses a wrong secret and stores nothing", async () => {
    const res = await route.POST(post(JSON.stringify(coworkExport()), { authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
    expect(ingest.ingestCoworkEvents).not.toHaveBeenCalled();
  });

  it("refuses a request with no secret at all", async () => {
    const req = new Request("https://ankora.test/api/otel/v1/logs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await route.POST(req)).status).toBe(401);
  });

  it("says it is not configured, with a retryable status, while the secret is unset", async () => {
    delete process.env.COWORK_OTEL_SECRET;
    const res = await route.POST(post("{}"));
    expect(res.status).toBe(503);
    expect(ingest.ingestCoworkEvents).not.toHaveBeenCalled();
  });

  it("stores the events, without their content, and reports the skipped ones", async () => {
    const res = await route.POST(post(JSON.stringify(coworkExport())));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ partialSuccess: { rejectedLogRecords: "1", errorMessage: expect.any(String) } });
    const rows = ingest.ingestCoworkEvents.mock.calls[0][0];
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toContain(SECRET_PROMPT);
  });

  it("reads a gzip body", async () => {
    const res = await route.POST(post(new Uint8Array(gzipSync(JSON.stringify(coworkExport()))), { "content-encoding": "gzip" }));
    expect(res.status).toBe(200);
    expect(ingest.ingestCoworkEvents.mock.calls[0][0]).toHaveLength(4);
  });

  it("asks for http/json when it gets protobuf", async () => {
    const res = await route.POST(post(new Uint8Array([1, 2, 3]), { "content-type": "application/x-protobuf" }));
    expect(res.status).toBe(415);
  });

  it("refuses a body over the cap, by its declared length or by what arrives", async () => {
    expect((await route.POST(post("{}", { "content-length": String(5 * 1024 * 1024) }))).status).toBe(413);
    const big = "x".repeat(4 * 1024 * 1024 + 1);
    expect((await route.POST(post(big))).status).toBe(413);
    expect(ingest.ingestCoworkEvents).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON, or a gzip that is not gzip, without retry", async () => {
    expect((await route.POST(post("not json"))).status).toBe(400);
    expect((await route.POST(post("not gzip", { "content-encoding": "gzip" }))).status).toBe(400);
  });

  it("answers 503 when storing fails, so the exporter tries again later", async () => {
    ingest.ingestCoworkEvents.mockRejectedValueOnce(new Error("database down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await route.POST(post(JSON.stringify(coworkExport())));
    expect(res.status).toBe(503);
  });
});
