import { describe, expect, it } from "vitest";
import { compileAgent, type CompileAddition, type CompileClient } from "@/lib/agents/compile";
import { additionProblems, type AgentBlock, type AgentParam } from "@/lib/agents/model";

// Client additions versioned on their own (24.11.2026). What is worth
// holding: an installation on NUX reads "גרסה 7 + NUX 2"; a client block
// takes an agent block's place only when the owners marked it overridable
// and it is not a safety block, and otherwise it is added beside it; a
// client that has an addition no longer reads the version's legacy blocks.

const BLOCKS: AgentBlock[] = [
  { key: "role", kind: "role", title: "תפקיד", body: "אתה סוכן המייל." },
  { key: "tone", kind: "language", title: "טון", body: "כותבים בגוף ראשון.", overridable: true },
  { key: "never", kind: "rules", title: "לעולם לא", body: "לעולם לא שולחים.", safety: true, overridable: true },
  { key: "fixed", kind: "rules", title: "כלל קבוע", body: "מתייגים כל מייל." },
];
const PARAMS: AgentParam[] = [{ key: "sig", label: "חתימה", level: "CLIENT", type: "TEXT", required: false, default: null, clientField: null }];
const NUX: CompileClient = { id: "nux", name: "NUX", values: { sig: "צוות NUX" } };
const RIMED: CompileClient = { id: "rimed", name: "Rimed", values: {} };

const compile = (clients: CompileClient[], additions: CompileAddition[], blocks = BLOCKS) =>
  compileAgent({
    agent: { name: "Mail", slug: "mail", purpose: "מטפל במייל" },
    version: { version: 7, actionLevel: "DRAFT", blocks, params: PARAMS, requirements: { connectors: [], skills: [], repos: [], localMcp: [], externalRunners: [] } },
    installation: null,
    clients,
    additions,
  });

describe("compiling with a client's addition", () => {
  it("names the addition's version beside the agent's", () => {
    const out = compile([NUX], [{ clientId: "nux", version: 2, blocks: [{ key: "n1", kind: "rules", title: "חשבוניות", body: "חותמים {{sig}}." }] }]);
    expect(out.header).toContain("גרסה 7 + NUX 2");
    expect(out.text).toContain("## ללקוח NUX: חשבוניות");
    expect(out.text).toContain("חותמים צוות NUX.");
    expect(compile([NUX], []).header).not.toContain("+");
  });

  it("replaces an overridable block in its place, and only for that client", () => {
    const additions = [{ clientId: "nux", version: 1, blocks: [{ key: "t", kind: "language" as const, title: "טון ל-NUX", body: "כותבים בגוף שני.", replaces: "tone" }] }];
    const one = compile([NUX], additions).body;
    expect(one).toContain("## טון ל-NUX");
    expect(one).not.toContain("כותבים בגוף ראשון.");
    expect(one).not.toContain("ללקוח NUX");
    // With several clients the agent's block stays, and NUX's reads as "instead of".
    const many = compile([NUX, RIMED], additions).body;
    expect(many).toContain("כותבים בגוף ראשון.");
    expect(many).toContain('## ללקוח NUX, במקום "טון": טון ל-NUX');
    expect(compile([RIMED], additions).body).not.toContain("גוף שני");
  });

  it("adds a block beside one it may not replace: a safety block or one not marked", () => {
    for (const target of ["never", "fixed"]) {
      const out = compile([NUX], [{ clientId: "nux", version: 1, blocks: [{ key: "x", kind: "rules", title: "אחר", body: "טקסט של NUX.", replaces: target }] }]).body;
      expect(out).toContain("## ללקוח NUX: אחר");
      expect(out).toContain(target === "never" ? "לעולם לא שולחים." : "מתייגים כל מייל.");
    }
  });

  it("reads a legacy client block only until the client has an addition", () => {
    const legacy = [...BLOCKS, { key: "old", kind: "rules" as const, title: "ישן", body: "כלל ישן של NUX.", clientId: "nux" }];
    expect(compile([NUX], [], legacy).body).toContain("כלל ישן של NUX.");
    const moved = compile([NUX], [{ clientId: "nux", version: 1, blocks: [{ key: "old", kind: "rules", title: "ישן", body: "כלל ישן של NUX." }] }], legacy).body;
    expect(moved.match(/כלל ישן של NUX\./g)).toHaveLength(1);
  });
});

describe("what stops an addition", () => {
  const check = (blocks: AgentBlock[], changeNote = "שינוי") => additionProblems({ blocks, agentBlocks: BLOCKS, params: PARAMS, changeNote }).map((p) => p.code);

  it("allows replacing an overridable block", () => {
    expect(check([{ key: "a", kind: "language", title: "טון", body: "{{sig}}", replaces: "tone" }])).toEqual([]);
  });

  it("refuses replacing a safety block, an unmarked one or a missing one", () => {
    expect(check([{ key: "a", kind: "rules", title: "x", body: "y", replaces: "never" }])).toEqual(["replaceSafety"]);
    expect(check([{ key: "a", kind: "rules", title: "x", body: "y", replaces: "fixed" }])).toEqual(["replaceNotAllowed"]);
    expect(check([{ key: "a", kind: "rules", title: "x", body: "y", replaces: "gone" }])).toEqual(["replaceMissing"]);
  });

  it("refuses a dash, an unknown parameter and the same block replaced twice", () => {
    expect(check([{ key: "a", kind: "rules", title: "x", body: `y ${String.fromCharCode(0x2014)} z` }])).toEqual(["dash"]);
    expect(check([{ key: "a", kind: "rules", title: "x", body: "{{nope}}" }])).toEqual(["undefinedParam"]);
    expect(check([{ key: "a", kind: "language", title: "x", body: "y", replaces: "tone" }, { key: "b", kind: "language", title: "x", body: "y", replaces: "tone" }])).toEqual(["replaceTwice"]);
  });
});
