import { describe, expect, it, vi } from "vitest";
import { FIELD_NOTES_SENTENCE, withFieldNotes } from "@/lib/mcp/field-notes";
import {
  DECIDE_PROPOSALS_NOTES,
  GET_PROCESS_NOTES,
  LIST_APPROVALS_NOTES,
  PROCESS_SUMMARY_NOTES,
  PROPOSAL_STATS_NOTES,
  UPDATE_TASK_NOTES,
} from "@/lib/mcp/tool-field-notes";
import { registerAnkoraTools } from "@/lib/mcp/tools";

// 17.11.2026: what a result field means travels with the result, so a new
// field changes no tool definition (Claude Desktop asks to allow a tool
// again whenever its definition changes). See lib/mcp/field-notes.ts.

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("withFieldNotes", () => {
  const notes = { rows: "the rows", autoError: "an error", url: "a link", missing: "never here" };

  it("adds the notes of the fields the result carries, at any depth, in the notes' order", () => {
    const out = withFieldNotes({ url: "u", rows: [{ id: 1, autoError: { type: "REVERTED" } }] }, notes);
    expect(out.fieldNotes).toEqual({ rows: "the rows", autoError: "an error", url: "a link" });
    expect(Object.keys(out.fieldNotes!)).toEqual(["rows", "autoError", "url"]);
  });

  it("leaves out the note of a field that is undefined, and keeps the one of a field that is null", () => {
    const out = withFieldNotes({ rows: undefined, autoError: null }, notes);
    expect(out.fieldNotes).toEqual({ autoError: "an error" });
  });

  it("adds nothing when no field has a note, so the result is as before", () => {
    const value = { count: 0 };
    expect(withFieldNotes(value, notes)).toEqual({ count: 0 });
  });

  it("always adds a note keyed *", () => {
    expect(withFieldNotes({ count: 0 }, { "*": "always" }).fieldNotes).toEqual({ "*": "always" });
  });

  it("puts fieldNotes last, after the data", () => {
    expect(Object.keys(withFieldNotes({ url: "u", count: 1 }, notes)).at(-1)).toBe("fieldNotes");
  });
});

describe("the tools whose results explain their fields", () => {
  const configs = new Map<string, { description?: string }>();
  registerAnkoraTools({ registerTool: (name: string, config: { description?: string }) => configs.set(name, config) } as never);

  const TOOLS: [string, Record<string, string>][] = [
    ["get_proposal_stats", PROPOSAL_STATS_NOTES],
    ["list_approvals", LIST_APPROVALS_NOTES],
    ["decide_knowledge_proposals", DECIDE_PROPOSALS_NOTES],
    ["list_processes", PROCESS_SUMMARY_NOTES],
    ["get_process", GET_PROCESS_NOTES],
    ["update_task", UPDATE_TASK_NOTES],
  ];

  it.each(TOOLS)("%s tells Claude to read fieldNotes", (name) => {
    expect(configs.get(name)?.description).toContain(FIELD_NOTES_SENTENCE);
  });

  it.each(TOOLS)("%s has a note for every field it used to explain in its description", (_name, notes) => {
    expect(Object.keys(notes).length).toBeGreaterThan(0);
    for (const note of Object.values(notes)) expect(note.trim().length).toBeGreaterThan(10);
  });
});
