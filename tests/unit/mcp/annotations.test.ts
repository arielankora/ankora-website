import { describe, expect, it } from "vitest";
import {
  READ_ONLY,
  TEAM_TOOLS,
  TOOL_ANNOTATIONS,
  WRITES,
  WRITE_TOOLS,
} from "@/lib/mcp/annotations";

// Phase 14 (MCP server writes, docs/adr/0005).
//
// `readOnlyHint: true` is what tells an MCP client a tool is safe to call
// without asking the user. On a write tool that would mean Claude booking
// time against a client with no confirmation step - quiet and wrong. This
// file exists so that mistake cannot be made by editing one object
// literal.

describe("the read/write split", () => {
  it("never marks a write tool read-only", () => {
    for (const name of WRITE_TOOLS) {
      expect(TOOL_ANNOTATIONS[name].readOnlyHint, name).toBe(false);
    }
  });

  it("marks every non-write tool read-only", () => {
    const writes = new Set<string>(WRITE_TOOLS);
    for (const [name, ann] of Object.entries(TOOL_ANNOTATIONS)) {
      if (writes.has(name)) continue;
      expect(ann.readOnlyHint, name).toBe(true);
    }
  });

  it("lists every write tool in WRITE_TOOLS", () => {
    // The guard against the reverse mistake: adding a write tool to
    // TOOL_ANNOTATIONS but forgetting WRITE_TOOLS would make the first
    // assertion above vacuously pass for it.
    const declaredWrites = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, a]) => a.readOnlyHint === false)
      .map(([n]) => n)
      .sort();
    expect(declaredWrites).toEqual([...WRITE_TOOLS].sort());
  });

  it("marks only the two step-replacing tools as destructive, because they are the only ones that remove", () => {
    // replace_task_steps, and apply_task_plan_steps ("קדם עם קלוד",
    // 10.10.2026), which does the same replacement from a plan's steps.
    const destructive = Object.entries(TOOL_ANNOTATIONS)
      .filter(([, ann]) => ann.destructiveHint)
      .map(([name]) => name)
      .sort();
    expect(destructive).toEqual(["apply_task_plan_steps", "replace_task_steps"]);
  });

  it("does not claim create_time_entry is idempotent", () => {
    // Calling it twice makes two entries. A client that retried on a
    // timeout would otherwise double-book an afternoon.
    expect(TOOL_ANNOTATIONS.create_time_entry.idempotentHint).toBe(false);
  });

  it("does claim update_timer_note is idempotent, because it is", () => {
    expect(TOOL_ANNOTATIONS.update_timer_note.idempotentHint).toBe(true);
    expect(TOOL_ANNOTATIONS.update_timer_note.readOnlyHint).toBe(false);
  });

  it("keeps every tool closed-world", () => {
    // Nothing here reaches outside Ankora's own database.
    for (const [name, ann] of Object.entries(TOOL_ANNOTATIONS)) {
      expect(ann.openWorldHint, name).toBe(false);
    }
  });
});

describe("team tools", () => {
  it("are all registered tools", () => {
    for (const name of TEAM_TOOLS) {
      expect(Object.keys(TOOL_ANNOTATIONS)).toContain(name);
    }
  });

  it("are read-only - reading a colleague's time never writes", () => {
    for (const name of TEAM_TOOLS) {
      expect(TOOL_ANNOTATIONS[name].readOnlyHint, name).toBe(true);
    }
  });
});

describe("the two annotation presets", () => {
  it("differ on exactly the hint that gates confirmation", () => {
    expect(READ_ONLY.readOnlyHint).toBe(true);
    expect(WRITES.readOnlyHint).toBe(false);
  });

  it("do not leak into each other", () => {
    // Both are `as const` object literals; this catches someone later
    // writing `const WRITES = { ...READ_ONLY, ... }` and missing a field.
    expect(READ_ONLY).not.toEqual(WRITES);
  });
});
