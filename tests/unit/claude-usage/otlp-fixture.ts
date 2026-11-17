// An OTLP/JSON export shaped like Cowork's, per
// https://claude.com/docs/cowork/monitoring. It carries content on
// purpose (prompt, response, tool_input, host paths, a tool's error), the
// way an older desktop app sends it, so tests can prove none of it is kept.

type Attr = { key: string; value: Record<string, unknown> };
const s = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });
const i = (key: string, v: number): Attr => ({ key, value: { intValue: String(v) } });
const d = (key: string, v: number): Attr => ({ key, value: { doubleValue: v } });

export const SECRET_PROMPT = "Draft the NUX termination letter, do not tell Hadas";
export const SECRET_PATH = "/Users/hadas/Clients/NUX";

const standard = (seq: number): Attr[] => [
  s("session.id", "sess-1"),
  s("prompt.id", "prompt-1"),
  s("organization.id", "org-1"),
  s("user.account_uuid", "acct-1"),
  s("user.email", "Hadas@Ankora.co.il"),
  { key: "workspace.host_paths", value: { arrayValue: { values: [{ stringValue: SECRET_PATH }] } } },
  s("event.timestamp", "2026-11-17T08:00:00.000Z"),
  i("event.sequence", seq),
];

export function coworkExport(extra: { records?: unknown[] } = {}) {
  return {
    resourceLogs: [
      {
        resource: { attributes: [s("service.name", "cowork"), s("service.version", "4.17000.0"), s("process.owner", "hadas")] },
        scopeLogs: [
          {
            logRecords: extra.records ?? [
              {
                timeUnixNano: "1763366400000000000",
                body: { stringValue: "cowork.user_prompt" },
                attributes: [...standard(1), s("event.name", "user_prompt"), i("prompt_length", 51), s("prompt", SECRET_PROMPT)],
              },
              {
                body: { stringValue: "cowork.api_request" },
                attributes: [
                  ...standard(2),
                  s("event.name", "api_request"),
                  s("model", "claude-sonnet-5"),
                  d("cost_usd", 0.0421),
                  i("input_tokens", 1200),
                  i("output_tokens", 340),
                  i("cache_read_tokens", 50000),
                  i("cache_creation_tokens", 800),
                  i("duration_ms", 5300),
                  s("speed", "normal"),
                ],
              },
              {
                body: { stringValue: "cowork.tool_result" },
                attributes: [
                  ...standard(3),
                  s("event.name", "tool_result"),
                  s("tool_name", "mcp_tool"),
                  s("tool_use_id", "tu-1"),
                  s("success", "false"),
                  i("duration_ms", 900),
                  i("tool_result_size_bytes", 48213),
                  s("mcp_server_scope", "claudeai"),
                  s("tool_parameters", JSON.stringify({ mcp_server_name: "Ankora MCP", mcp_tool_name: "get_client_file", client: "NUX" })),
                  s("tool_input", JSON.stringify({ client: "NUX" })),
                  s("error", `Could not read ${SECRET_PATH}`),
                ],
              },
              {
                body: { stringValue: "cowork.api_error" },
                attributes: [
                  ...standard(4),
                  s("event.name", "api_error"),
                  s("model", "claude-opus-5"),
                  s("error", "rate_limit_error: " + "x".repeat(1000)),
                  s("status_code", "429"),
                  i("attempt", 2),
                ],
              },
              {
                body: { stringValue: "cowork.assistant_response" },
                attributes: [...standard(5), s("event.name", "assistant_response"), s("response", "Dear NUX, ...")],
              },
            ],
          },
        ],
      },
    ],
  };
}
