import { describe, expect, it } from "vitest";
import { registerAnkoraTools } from "@/lib/mcp/tools";
import { registerPortalTools } from "@/lib/mcp/portal-tools";
import { AI_EXCLUSION_COVERAGE } from "@/lib/mcp/ai-exclusion-coverage";

// "בלי AI" (28.10.2026): every tool either connector registers has a line
// in AI_EXCLUSION_COVERAGE saying how it keeps marked items out, and the
// map names no tool that does not exist. A new tool without a line fails
// here, before it can hand a marked task or document to a model.
//
// Two tools share a name across the connectors (list_tasks,
// list_decisions); the portal's are keyed "portal:<name>".

function names(register: (server: never) => void): string[] {
  const out: string[] = [];
  register({ registerTool: (name: string) => void out.push(name) } as never);
  return out;
}

describe("בלי AI coverage of the MCP tools", () => {
  const staff = names(registerAnkoraTools);
  const portal = names(registerPortalTools).map((n) => (staff.includes(n) ? `portal:${n}` : n));
  const registered = [...staff, ...portal].sort();

  it("registers the tools this map was written for", () => {
    expect(staff.length).toBeGreaterThan(40);
    expect(portal.length).toBeGreaterThan(5);
  });

  it("every registered tool says how it honours the mark", () => {
    const missing = registered.filter((n) => !AI_EXCLUSION_COVERAGE[n]?.trim());
    expect(missing, `Add a line to lib/mcp/ai-exclusion-coverage.ts for: ${missing.join(", ")}`).toEqual([]);
  });

  it("names no tool that is not registered", () => {
    const stale = Object.keys(AI_EXCLUSION_COVERAGE).filter((n) => !registered.includes(n));
    expect(stale).toEqual([]);
  });
});
