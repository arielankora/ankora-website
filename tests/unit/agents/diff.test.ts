import { describe, expect, it } from "vitest";
import { diffBlocks, diffLines, diffParams } from "@/lib/agents/diff";
import { changeNotePrompt } from "@/lib/agents/change-note-prompt";
import type { AgentBlock, AgentParam } from "@/lib/agents/model";

// The versions screen's block-by-block diff and the prompt built from it
// ("נסח עם קלוד"). Before 23.11.2026 only agent-spec-gaps touched them.

const role: AgentBlock = { key: "role", kind: "role", title: "תפקיד", body: "אתה סוכן הלקוח." };
const rules: AgentBlock = { key: "rules", kind: "rules", title: "כללים", body: "שורה אחת.\nשורה שתיים.\nשורה שלוש." };
const out: AgentBlock = { key: "out", kind: "output", title: "פלט", body: "טבלה." };

describe("diffLines", () => {
  it("keeps the lines both share and marks the rest", () => {
    expect(diffLines("א\nב\nג", "א\nג\nד")).toEqual([
      { type: "same", text: "א" },
      { type: "del", text: "ב" },
      { type: "same", text: "ג" },
      { type: "add", text: "ד" },
    ]);
  });

  it("handles one side empty", () => {
    expect(diffLines("", "א")).toEqual([{ type: "del", text: "" }, { type: "add", text: "א" }]);
    expect(diffLines("א\nב", "א\nב")).toEqual([{ type: "same", text: "א" }, { type: "same", text: "ב" }]);
  });
});

describe("diffBlocks", () => {
  it("counts unchanged blocks and reports nothing else", () => {
    expect(diffBlocks([role, rules], [role, rules])).toEqual({ changes: [], unchanged: 2 });
  });

  it("reports an added block with every line added", () => {
    const { changes, unchanged } = diffBlocks([role], [role, out]);
    expect(unchanged).toBe(1);
    expect(changes).toEqual([{ key: "out", title: "פלט", kind: "output", clientId: undefined, status: "added", lines: [{ type: "add", text: "טבלה." }] }]);
  });

  it("reports a removed block with every line removed, after the others", () => {
    const changed = { ...role, body: "אתה סוכן." };
    const { changes } = diffBlocks([role, rules], [changed]);
    expect(changes.map((c) => [c.key, c.status])).toEqual([["role", "changed"], ["rules", "removed"]]);
    expect(changes[1].lines.every((l) => l.type === "del")).toBe(true);
    expect(changes[1].lines).toHaveLength(3);
  });

  it("diffs a changed block line by line, title and why included", () => {
    const after = { ...rules, title: "כללים חדשים", body: "שורה אחת.\nשורה 2.\nשורה שלוש.", why: "כי ביקשו." };
    const [c] = diffBlocks([rules], [after]).changes;
    expect(c).toMatchObject({ key: "rules", title: "כללים חדשים", status: "changed" });
    expect(c.lines.filter((l) => l.type !== "same")).toEqual([
      { type: "del", text: "כללים" },
      { type: "add", text: "כללים חדשים" },
      { type: "del", text: "שורה שתיים." },
      { type: "add", text: "שורה 2." },
      { type: "del", text: "" },
      { type: "add", text: "כי ביקשו." },
    ]);
  });

  it("does not report blocks that only moved: the compiled order comes from their kind", () => {
    expect(diffBlocks([role, rules, out], [out, role, rules])).toEqual({ changes: [], unchanged: 3 });
  });

  it("reports a change of kind, client, safety, overridable or replaces even when the text is the same", () => {
    for (const after of [{ ...rules, kind: "approvals" as const }, { ...rules, clientId: "c1" }, { ...rules, safety: true }, { ...rules, overridable: true }, { ...rules, replaces: "role" }]) {
      const { changes } = diffBlocks([rules], [after]);
      expect(changes).toHaveLength(1);
      expect(changes[0].status).toBe("changed");
      expect(changes[0].lines.every((l) => l.type === "same")).toBe(true);
    }
  });

  it("treats a missing and a null client, and a missing and a false flag, as the same", () => {
    expect(diffBlocks([{ ...rules, clientId: null, safety: false }], [rules]).unchanged).toBe(1);
  });

  it("carries the client of a client block", () => {
    const client: AgentBlock = { ...rules, key: "nux", clientId: "c1" };
    expect(diffBlocks([], [client]).changes[0].clientId).toBe("c1");
  });
});

describe("diffParams", () => {
  const sig: AgentParam = { key: "sig", label: "חתימה", level: "CLIENT", type: "TEXT", required: true, default: null, clientField: null };
  const limit: AgentParam = { key: "limit", label: "מכסה", level: "INSTALLATION", type: "NUMBER", required: false, default: "20", clientField: null };

  it("names added, removed and changed parameters by label", () => {
    const tone: AgentParam = { ...sig, key: "tone", label: "טון" };
    expect(diffParams([sig, limit], [{ ...limit, default: "10" }, tone])).toEqual({ added: ["טון"], removed: ["חתימה"], changed: ["מכסה"] });
  });

  it("reports nothing for the same parameters", () => {
    expect(diffParams([sig, limit], [sig, limit])).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe("the change note prompt", () => {
  const params: AgentParam[] = [{ key: "limit", label: "מכסה", level: "INSTALLATION", type: "NUMBER", required: false, default: "20", clientField: null }];

  it("lists every changed block with its status, and only the lines that changed", () => {
    const text = changeNotePrompt({
      agentName: "Client agent",
      before: { blocks: [role, rules], params, actionLevel: "DRAFT" },
      after: { blocks: [{ ...role, body: "אתה סוכן הלקוח. ענה קצר." }, { ...out, clientId: "c1" }], params: [], actionLevel: "SEND" },
    });
    expect(text).toContain('בסוכן "Client agent"');
    expect(text).toContain("### תפקיד (שונה)");
    expect(text).toContain("- אתה סוכן הלקוח.\n+ אתה סוכן הלקוח. ענה קצר.");
    expect(text).toContain("### פלט (נוסף, תוספת ללקוח אחד)");
    expect(text).toContain("### כללים (הוסר)");
    expect(text).toContain("- שורה שתיים.");
    expect(text).toContain("פרמטרים: הוסרו מכסה");
    // The action level going up is said in words: a sending agent is a different agent.
    expect(text).toContain("רמת הפעולה השתנתה מ-DRAFT ל-SEND.");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("says when nothing changed, and treats a first version as all new", () => {
    expect(changeNotePrompt({ agentName: "A", before: { blocks: [role], params, actionLevel: "READ" }, after: { blocks: [role], params, actionLevel: "READ" } })).toContain("לא נמצאו הבדלים בקטעים או בפרמטרים.");
    const first = changeNotePrompt({ agentName: "A", before: null, after: { blocks: [role], params, actionLevel: "SEND" } });
    expect(first).toContain("### תפקיד (נוסף)");
    expect(first).toContain("פרמטרים: נוספו מכסה");
    expect(first).not.toContain("רמת הפעולה השתנתה");
  });
});
