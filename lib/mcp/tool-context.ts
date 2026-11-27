import { AsyncLocalStorage } from "node:async_hooks";

/// The tool call in progress, for code that runs inside it without being
/// handed it (27.11.2026). toMcpToolError is called from inside 80 handlers
/// and does not know which tool it serves; withToolMeasurement does. The
/// unexpected error is left here, and the wrapper reports it once the
/// handler is done, with the tool's name.
///
/// No Prisma and no Next imports: tests/unit loads measure.ts, which uses it.
export type ToolCallContext = { tool: string; unexpected?: unknown };

export const toolCallContext = new AsyncLocalStorage<ToolCallContext>();

/// Called by toMcpToolError's fallback. A no-op outside a measured tool call
/// (the portal connector, a test that calls a handler directly).
export function noteUnexpectedToolError(err: unknown): void {
  const store = toolCallContext.getStore();
  if (store && store.unexpected === undefined) store.unexpected = err;
}
