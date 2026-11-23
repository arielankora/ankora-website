import { describe, expect, it } from "vitest";
import { bootstrapText, compileAgent, type CompileInput } from "@/lib/agents/compile";
import { procedureSection } from "@/lib/agents/procedure";

// ADR 0006 for agents (23.11.2026): the fixed headings and lines compile
// adds follow the installation owner's User.locale, Hebrew by default. What
// people wrote (the purpose, block titles and bodies, values) is content
// and goes in exactly as written, in either language.

const HEBREW = /[֐-׿]/;

const input: CompileInput = {
  agent: { name: "ממיין", slug: "sorter", purpose: "ממיין מיילים נכנסים." },
  version: {
    version: 3,
    actionLevel: "DRAFT",
    blocks: [
      { key: "steps", kind: "steps", title: "צעדים", body: "1. לקרוא את {{inbox}}.", why: "כדי לא לפספס." },
      { key: "extra", kind: "rules", title: "כלל ללקוח", body: "לא לענות בשישי.", clientId: "c1" },
    ],
    params: [
      { key: "inbox", label: "תיבה", level: "CLIENT", type: "TEXT", required: true, default: null, clientField: null },
      { key: "secret", label: "סוד", level: "INSTALLATION", type: "VAULT_REF", required: true, default: null, clientField: null },
    ],
    requirements: { connectors: ["Gmail"], skills: [{ slug: "gmail-labels", minVersion: 2 }], repos: [], localMcp: [], externalRunners: [] },
    files: [{ path: "scripts/run.py", content: "print(1)" }],
  },
  installation: { id: "inst1", values: {}, userName: "Dana" },
  clients: [
    { id: "c1", name: "Acme", values: { inbox: "ops@acme.test" } },
    { id: "c2", name: "Beta", values: {} },
  ],
};

describe("compiled instructions by the owner's language", () => {
  it("keeps the Hebrew headings by default", () => {
    const { text } = compileAgent(input);
    for (const h of ["## רמת פעולה", "## לפי לקוח", "## ללקוח Acme: כלל ללקוח", "## קבצים מצורפים", "## דרישות", "## חסר", "גרסה 3 · התקנה inst1 · עבור Dana"]) expect(text).toContain(h);
    expect(text).toContain("למה: כדי לא לפספס.");
    expect(text).toContain("gmail-labels (גרסה 2 ומעלה)");
    expect(compileAgent({ ...input, locale: "he" }).text).toBe(text);
  });

  it("writes the fixed text in English for an English owner, and leaves the blocks as written", () => {
    const { text } = compileAgent({ ...input, locale: "en" });
    for (const h of ["## Action level", "## Per client", "## For client Acme: כלל ללקוח", "## Attached files", "## Requirements", "## Missing", "Version 3 · installation inst1 · for Dana"]) expect(text).toContain(h);
    expect(text).toContain("Why: כדי לא לפספס.");
    expect(text).toContain("Connections: Gmail");
    expect(text).toContain("gmail-labels (version 2 or later)");
    expect(text).toContain("scripts/run.py (8 characters)");
    expect(text).toContain('- The installation has no value for "סוד". Stop and report.');
    expect(text).toContain('- Do not work on Beta: no value for "תיבה". Report what is missing.');
    // Content is untouched.
    expect(text).toContain("ממיין מיילים נכנסים.");
    expect(text).toContain("## צעדים");
    // Every Hebrew line comes from what people wrote, never from compile.
    const fixed = text.split("\n").filter((l) => HEBREW.test(l));
    for (const l of fixed) expect(/ממיין|צעדים|לקרוא|לפספס|כלל ללקוח|לענות|תיבה|סוד/.test(l), l).toBe(true);
  });

  it("names a vault item in the owner's language, and never wraps it twice", () => {
    const withValue = { ...input, installation: { id: "inst1", values: { secret: "smtp" }, userName: "Dana" } };
    const block = { key: "s", kind: "tools" as const, title: "T", body: "{{secret}}" };
    const en = compileAgent({ ...withValue, version: { ...input.version, blocks: [block] }, locale: "en" }).text;
    expect(en).toContain("[secret: smtp, read from the vault]");
    const he = compileAgent({ ...withValue, version: { ...input.version, blocks: [block] } }).text;
    expect(he).toContain("[סוד: smtp, נקרא מהכספת]");
  });

  it("words the bootstrap text and the procedure section in the owner's language", () => {
    expect(bootstrapText({ name: "ממיין" }, "inst1")).toContain('קרא לכלי get_agent של Ankora עם installation "inst1"');
    const en = bootstrapText({ name: "ממיין" }, "inst1", "en");
    expect(en).toContain('call Ankora\'s get_agent tool with installation "inst1"');
    expect(HEBREW.test(en.replace("ממיין", ""))).toBe(false);
    const proc = { ok: true as const, code: "P1", title: "קליטה", clientName: "Acme", version: 2, steps: [{ n: 1, title: "לפתוח תיק", output: "תיק", verification: null, needsApproval: true }], highlights: null, outputs: null, failsRules: [] };
    expect(procedureSection(proc)).toContain("## הנוהל: P1 קליטה (Acme, גרסה 2)");
    const enProc = procedureSection(proc, "en");
    expect(enProc).toContain("## The procedure: P1 קליטה (Acme, version 2)");
    expect(enProc).toContain("1. לפתוח תיק (needs a person's approval)");
    expect(enProc).toContain("   - Output: תיק");
  });
});
