#!/usr/bin/env node
// Phase 13 (MCP server, docs/adr/0005): the stdio bridge Claude Desktop
// runs locally.
//
// Claude Desktop launches this file, speaks newline-delimited JSON-RPC to
// it over stdin/stdout, and this forwards each message to the app's
// /api/mcp endpoint with the employee's personal access token attached.
//
// Why a bridge at all: Claude's hosted surfaces (claude.ai, Desktop
// connectors, mobile, Cowork) authenticate custom remote MCP servers with
// OAuth. There is a beta "static header" option, but the credential it
// stores is entered once by an org admin and SHARED BY THE WHOLE
// ORGANIZATION - which would collapse every per-user check the app is
// built on (lib/app-auth/permissions.ts, UserClientAccess scoping, the
// actor on every AuditEvent) into one anonymous identity. A local stdio
// server has no such constraint: it holds one person's token, so the
// server sees one person. Phase 2 replaces this with a real OAuth
// authorization server and the bridge goes away.
//
// Why hand-written rather than `npx mcp-remote`: that package does the
// same job and is a reasonable alternative, but this file is ~120 lines
// with zero dependencies, and it is the thing that holds an employee's
// credential. A no-dependency local file is a smaller supply-chain
// surface than a transitively-updating npm package for that specific job.
//
// Usage (Claude Desktop config, see README):
//   command: node
//   args:    ["/absolute/path/to/scripts/mcp-bridge.mjs"]
//   env:     ANKORA_MCP_URL, ANKORA_MCP_TOKEN

const URL_ = process.env.ANKORA_MCP_URL;
const TOKEN = process.env.ANKORA_MCP_TOKEN;

// stderr, never stdout: stdout is the JSON-RPC channel and anything
// non-protocol written there corrupts the stream. Claude Desktop surfaces
// stderr in its MCP log, which is where a misconfiguration should show up.
function logError(...args) {
  console.error("[ankora-mcp-bridge]", ...args);
}

if (!URL_ || !TOKEN) {
  logError("ANKORA_MCP_URL and ANKORA_MCP_TOKEN must both be set.");
  process.exit(1);
}

/// Captured from the initialize response and echoed on every later
/// request, as the Streamable HTTP transport requires. Without it a server
/// is entitled to assume the oldest protocol revision.
let protocolVersion = null;
/// Echoed back if the server ever issues one. The app's handler is
/// stateless and does not, but a future deployment might.
let sessionId = null;

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

/// Turns a transport-level failure into a JSON-RPC error aimed at the id
/// that failed, so Claude Desktop shows the reason instead of waiting for
/// a response that will never arrive. -32000 is the reserved
/// implementation-defined server error range.
function writeTransportError(id, message) {
  if (id === undefined || id === null) return; // a notification expects no reply
  write({ jsonrpc: "2.0", id, error: { code: -32000, message } });
}

/// Streamable HTTP lets the server answer either with a single JSON body
/// or with an SSE stream, and a stateless deployment can legitimately do
/// either. Both are handled: SSE frames are unwrapped and each `data:`
/// payload is emitted as its own line, which is exactly the framing the
/// stdio side expects.
async function relaySse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line; a single event may carry
    // several `data:` lines that concatenate.
    let separator;
    while ((separator = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);

      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data) continue;

      try {
        write(JSON.parse(data));
      } catch {
        logError("could not parse SSE payload, dropping frame");
      }
    }
  }
}

async function forward(message) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${TOKEN}`,
  };
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  if (sessionId) headers["mcp-session-id"] = sessionId;

  let response;
  try {
    response = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(message) });
  } catch (err) {
    logError("request failed:", err?.message ?? err);
    writeTransportError(message.id, `Could not reach Ankora at ${URL_}: ${err?.message ?? err}`);
    return;
  }

  const issued = response.headers.get("mcp-session-id");
  if (issued) sessionId = issued;

  if (response.status === 401) {
    logError("Ankora rejected the token (401). Issue a new one with scripts/mcp-issue-token.ts.");
    writeTransportError(
      message.id,
      "Ankora rejected this MCP token. It may be revoked, expired, or the account may no longer be active. Ask the user to issue a new token."
    );
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logError(`HTTP ${response.status}`, text.slice(0, 500));
    writeTransportError(message.id, `Ankora returned HTTP ${response.status}.`);
    return;
  }

  // 202 with no body is the correct answer to a notification.
  if (response.status === 202 || !response.body) return;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    await relaySse(response.body);
    return;
  }

  const text = await response.text();
  if (!text.trim()) return;
  try {
    const parsed = JSON.parse(text);
    // Remember the negotiated revision so every later request carries it.
    if (message.method === "initialize" && parsed?.result?.protocolVersion) {
      protocolVersion = parsed.result.protocolVersion;
    }
    write(parsed);
  } catch {
    logError("could not parse response body as JSON");
    writeTransportError(message.id, "Ankora returned a malformed response.");
  }
}

// Messages are processed strictly in order. A tool call is not worth
// pipelining here, and serialising keeps responses in the order Claude
// Desktop sent the requests.
let queue = Promise.resolve();
let stdinBuffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
  let newline;
  while ((newline = stdinBuffer.indexOf("\n")) !== -1) {
    const line = stdinBuffer.slice(0, newline).trim();
    stdinBuffer = stdinBuffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      logError("ignoring unparseable line from client");
      continue;
    }
    queue = queue.then(() => forward(message)).catch((err) => logError("relay error:", err));
  }
});

process.stdin.on("end", () => {
  queue.finally(() => process.exit(0));
});
