import type { McpHandlerOptions } from "mcp-handler";

// Caps on what a single MCP request may ask the server to validate
// (security review, 25.10.2026).
//
// GHSA-46jr-4wx8-v453 / CVE-2026-111768: the MCP TypeScript SDK put no
// ceiling on how many array elements and object members it would validate
// inside one `tools/call` `arguments` payload. One request, comfortably
// under the body-size limit, was enough to take the process to
// "JavaScript heap out of memory". The SDK's own fix landed in
// @modelcontextprotocol/server 2.3.0 as `maxToolInputElements` - and it is
// OFF by default, so the upgrade alone changes nothing. This constant is
// the half of the fix that is ours to write.
//
// Both MCP endpoints here authenticate before the SDK ever sees the body
// (`withMcpAuth(..., { required: true })`), so this was never an anonymous
// hole. It still mattered: /api/mcp/portal is reachable by a client's
// portal user, not only by staff, and the per-token rate limit of 120 a
// minute is no defence against something that needs exactly one request.
//
// 10,000 is far above any real call and far below anything dangerous. The
// widest tool input we have is propose_knowledge: 60 items, each a small
// object with an optional `alsoSources` array, plus `participants` on the
// source. A real extraction from an hour-long meeting lands in the low
// hundreds of elements.
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

/// Spread into every `createMcpHandler` call, never written inline.
///
/// `maxToolInputElements` belongs to the SDK's `McpServerOptions`, and
/// mcp-handler 2.3.0 types its own options as the SDK's `ServerOptions`,
/// which does not carry it. At runtime the option does arrive where it
/// needs to: mcp-handler collects everything it does not recognise with a
/// rest spread and hands it to `new McpServer(serverInfo, mcpServerOptions)`.
/// TypeScript refuses it anyway (TS2353, "does not exist in type
/// McpHandlerOptions") because an object literal may not carry unknown
/// properties. Hence this one cast, in one place, with this note.
///
/// Remove the cast once mcp-handler widens `McpHandlerOptions` to
/// `McpServerOptions`; the issue is filed upstream. Anything that makes
/// the cast wrong - the option moving, or being renamed - is caught by
/// tests/unit/mcp/input-limit.test.ts, which asserts the server actually
/// refuses an oversized payload rather than trusting the type.
export const TOOL_INPUT_LIMIT = {
  maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS,
} as unknown as McpHandlerOptions;
