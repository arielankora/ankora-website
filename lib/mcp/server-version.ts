// The version each MCP endpoint reports in serverInfo. 31.10.2026, RIMED:
// a deploy changed propose_knowledge's schema and a conversation that had
// already loaded the tools went on with the old one. These endpoints are
// stateless (a fresh server per request), so no notifications/tools/list_changed
// can ever reach a client. What a client can compare is serverInfo.version:
// it now changes with every deploy, by the commit it was built from.
export const MCP_SERVER_VERSION = `0.1.0+${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}`;
