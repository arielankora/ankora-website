// What an MCP endpoint publishes in tools/list, read without a request.
//
// 17.11.2026: Claude Desktop asks the user to allow a tool again whenever
// its definition changes, so a definition must change only when we mean
// it to. Two things here serve that:
//
// - listToolDefinitions builds the definitions the way the SDK's tools/list
//   does (lib/mcp/server-version.ts hashes them into serverInfo.version).
//   tests/unit/mcp/tool-definitions.test.ts checks that this is exactly what
//   the running endpoint publishes, so the version cannot drift from it.
// - The same test keeps every definition in a snapshot file, so a change
//   to any of them shows up in review instead of on the user's screen.

import { createHash } from "crypto";
import { z } from "zod";

export type ToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  annotations?: unknown;
};

type Register = (server: never) => void;
type ToolConfig = { title?: string; description?: string; inputSchema?: unknown; annotations?: unknown };
type StandardWithJson = { "~standard": { jsonSchema: { input: (o: { target: string }) => Record<string, unknown> } } };

/// What the SDK publishes when a tool has no inputSchema.
const EMPTY_OBJECT = { type: "object", properties: {} };

/// The SDK accepts a raw zod shape ({ field: z.string() }) as well as a
/// schema. It wraps a shape in z.object before converting it.
function asSchema(input: unknown): StandardWithJson {
  if (input && typeof input === "object" && !("~standard" in input)) return z.object(input as z.ZodRawShape) as unknown as StandardWithJson;
  return input as StandardWithJson;
}

/// The SDK's conversion for tools/list (standardSchemaToJsonSchema, input
/// side): the schema's own Standard JSON Schema output for draft 2020-12,
/// with `type: "object"` at the root.
function toJsonSchema(input: unknown): unknown {
  if (input === undefined) return EMPTY_OBJECT;
  const json = asSchema(input)["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  return { type: "object", ...json };
}

/// Every tool `register` registers, as tools/list would publish it.
export function listToolDefinitions(register: Register): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const stub = {
    registerTool(name: string, config: ToolConfig) {
      tools.push({
        name,
        title: config.title,
        description: config.description,
        inputSchema: toJsonSchema(config.inputSchema),
        annotations: config.annotations,
      });
    },
  };
  register(stub as never);
  return tools;
}

/// The same value whatever order the keys came in, and without the fields
/// a definition leaves undefined (JSON drops them on the wire too).
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalJson(v);
    }
    return out;
  }
  return value;
}

/// The definitions by tool name, sorted, in the shape the snapshot keeps.
export function canonicalDefinitions(tools: ToolDefinition[]): Record<string, unknown> {
  const byName: Record<string, unknown> = {};
  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    byName[tool.name] = canonicalJson({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    });
  }
  return byName;
}

/// Twelve hex characters of a hash over every definition. It changes when,
/// and only when, a name, title, description, inputSchema or annotations
/// of any tool changes.
export function toolDefinitionsHash(tools: ToolDefinition[]): string {
  return createHash("sha256").update(JSON.stringify(canonicalDefinitions(tools))).digest("hex").slice(0, 12);
}
