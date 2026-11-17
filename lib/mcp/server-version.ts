// The version each MCP endpoint reports in serverInfo. 31.10.2026, RIMED:
// a deploy changed propose_knowledge's schema and a conversation that had
// already loaded the tools went on with the old one. These endpoints are
// stateless (a fresh server per request), so no notifications/tools/list_changed
// can ever reach a client. What a client can compare is serverInfo.version.
//
// 17.11.2026: it used to change with every deploy, by the commit it was
// built from, dozens of times a month while the tools themselves changed
// far less often. A client that treats a new version as new tools then
// asks the user to allow them again for nothing. Now the version is a hash
// of the endpoint's tool definitions (lib/mcp/tool-definitions.ts): it
// changes exactly when what tools/list publishes changes, which is also
// all the 31.10 fix needs.

import { listToolDefinitions, toolDefinitionsHash } from "@/lib/mcp/tool-definitions";

const BASE = "0.1.0";

/// serverInfo.version for an endpoint whose tools `register` registers.
/// Should reading the definitions ever throw, the endpoint still starts,
/// with the commit as before; tests/unit/mcp/tool-definitions.test.ts fails
/// on that, so it never reaches a deploy unnoticed.
export function mcpServerVersion(register: (server: never) => void): string {
  try {
    return `${BASE}+${toolDefinitionsHash(listToolDefinitions(register))}`;
  } catch {
    return `${BASE}+${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}`;
  }
}
