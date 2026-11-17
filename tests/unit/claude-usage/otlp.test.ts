import { describe, expect, it } from "vitest";
import { ERROR_TEXT_MAX, parseOtlpLogs } from "@/lib/claude-usage/otlp";
import { coworkExport, SECRET_PATH, SECRET_PROMPT } from "./otlp-fixture";

// Claude usage measurement, stage 2 (17.11.2026). Cowork's telemetry can
// carry what an employee wrote and what Claude answered. Ankora keeps the
// measurements and nothing else, so the first property below is the one
// that matters most.

describe("parseOtlpLogs", () => {
  it("never keeps a prompt, an answer, a tool's input, a host path or a tool's error", () => {
    const { rows } = parseOtlpLogs(coworkExport());
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(SECRET_PROMPT);
    expect(stored).not.toContain("Dear NUX");
    expect(stored).not.toContain(SECRET_PATH);
    expect(stored).not.toContain('"client"');
    expect(stored).not.toContain("NUX");
  });

  it("keeps the four events that measure usage and drops the rest", () => {
    const { rows, skipped } = parseOtlpLogs(coworkExport());
    expect(rows.map((r) => r.eventName)).toEqual(["user_prompt", "api_request", "tool_result", "api_error"]);
    expect(skipped).toBe(1);
  });

  it("reads who, when and which app on every row", () => {
    const [row] = parseOtlpLogs(coworkExport()).rows;
    expect(row).toMatchObject({
      userEmail: "hadas@ankora.co.il",
      accountUuid: "acct-1",
      sessionId: "sess-1",
      promptId: "prompt-1",
      source: "cowork",
      appVersion: "4.17000.0",
      promptLength: 51,
    });
    expect(row.occurredAt.toISOString()).toBe("2026-11-17T08:00:00.000Z");
  });

  it("reads model, cost and the four token counts from an API request", () => {
    const api = parseOtlpLogs(coworkExport()).rows.find((r) => r.eventName === "api_request")!;
    expect(api).toMatchObject({
      model: "claude-sonnet-5",
      costUsd: "0.042100",
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 50000,
      cacheCreationTokens: 800,
      durationMs: 5300,
      speed: "normal",
    });
  });

  it("reads a tool result's size and only the two MCP names from its parameters", () => {
    const tool = parseOtlpLogs(coworkExport()).rows.find((r) => r.eventName === "tool_result")!;
    expect(tool).toMatchObject({
      toolName: "mcp_tool",
      toolSuccess: false,
      toolResultBytes: 48213,
      mcpServer: "Ankora MCP",
      mcpTool: "get_client_file",
      errorText: null,
    });
  });

  it("keeps an API error's status and a short reason, the signal for a person stuck at their limit", () => {
    const err = parseOtlpLogs(coworkExport()).rows.find((r) => r.eventName === "api_error")!;
    expect(err.statusCode).toBe("429");
    expect(err.attempt).toBe(2);
    expect(err.errorText!.startsWith("rate_limit_error")).toBe(true);
    expect(err.errorText!.length).toBe(ERROR_TEXT_MAX);
  });

  it("gives the same event the same key, and different events different keys", () => {
    const a = parseOtlpLogs(coworkExport()).rows;
    const b = parseOtlpLogs(coworkExport()).rows;
    expect(a.map((r) => r.dedupeKey)).toEqual(b.map((r) => r.dedupeKey));
    expect(new Set(a.map((r) => r.dedupeKey)).size).toBe(a.length);
  });

  it("falls back to the record's own time, and skips a record with no time or no name", () => {
    const { rows, skipped } = parseOtlpLogs(
      coworkExport({
        records: [
          { timeUnixNano: "1763366400000000000", attributes: [{ key: "event.name", value: { stringValue: "user_prompt" } }] },
          { attributes: [{ key: "event.name", value: { stringValue: "user_prompt" } }] },
          { timeUnixNano: "1763366400000000000", attributes: [] },
          null,
        ],
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].occurredAt.toISOString()).toBe("2025-11-17T08:00:00.000Z");
    expect(skipped).toBe(3);
  });

  it("refuses nonsense numbers rather than storing them", () => {
    const { rows } = parseOtlpLogs(
      coworkExport({
        records: [
          {
            timeUnixNano: "1763366400000000000",
            attributes: [
              { key: "event.name", value: { stringValue: "api_request" } },
              { key: "input_tokens", value: { intValue: "-5" } },
              { key: "output_tokens", value: { intValue: "99999999999999" } },
              { key: "cost_usd", value: { stringValue: "lots" } },
            ],
          },
        ],
      })
    );
    expect(rows[0]).toMatchObject({ inputTokens: null, outputTokens: null, costUsd: null });
  });

  it("answers an empty or foreign body with nothing", () => {
    expect(parseOtlpLogs(null)).toEqual({ rows: [], skipped: 0 });
    expect(parseOtlpLogs({ resourceSpans: [] })).toEqual({ rows: [], skipped: 0 });
  });
});
