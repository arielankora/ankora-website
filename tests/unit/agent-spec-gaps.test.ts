import { describe, expect, it } from "vitest";
import { compileAgent } from "@/lib/agents/compile";
import { changeNotePrompt } from "@/lib/agents/change-note-prompt";
import { parseRequirements, parseSkillText, skillText, versionProblems, type AgentBlock, type AgentParam } from "@/lib/agents/model";

// Four gaps from "סוכנים באנקורה: אפיון" (23.11.2026): a skill's minimum
// version, connector and vault parameters, a sending agent's quota, and
// the prompt behind "נסח עם קלוד".

const REQ = { connectors: [], skills: [], repos: [], localMcp: [], externalRunners: [] };
const block: AgentBlock = { key: "send", kind: "rules", title: "שליחה", body: "שלח מ-{{mail}} עם {{key}}." };
const params: AgentParam[] = [
  { key: "mail", label: "חיבור מייל", level: "AGENT", type: "CONNECTOR", required: true, default: "Gmail ops", clientField: null },
  { key: "key", label: "מפתח", level: "INSTALLATION", type: "VAULT_REF", required: true, default: null, clientField: null },
];

describe("a skill's minimum version", () => {
  it("accepts a plain slug and { slug, minVersion }, and round-trips the form's text", () => {
    const req = parseRequirements({ skills: ["drive-search", { slug: "gmail-labels", minVersion: 3 }] });
    expect(req.skills).toEqual(["drive-search", { slug: "gmail-labels", minVersion: 3 }]);
    expect(req.skills.map(skillText)).toEqual(["drive-search", "gmail-labels@3"]);
    expect(parseSkillText("gmail-labels@3")).toEqual({ slug: "gmail-labels", minVersion: 3 });
    expect(parseSkillText("drive-search")).toBe("drive-search");
  });

  it("shows the version in the compiled requirements", () => {
    const text = compileAgent({ agent: { name: "A", slug: "a", purpose: "בדיקה" }, version: { version: 1, actionLevel: "READ", blocks: [block], params, requirements: { ...REQ, skills: [{ slug: "gmail-labels", minVersion: 3 }] } }, installation: null, clients: [] }).text;
    expect(text).toContain("סקילים: gmail-labels (גרסה 3 ומעלה)");
  });
});

describe("connector and vault parameters", () => {
  it("compiles a connector as its name and a vault item as a reference only", () => {
    const text = compileAgent({ agent: { name: "A", slug: "a", purpose: "בדיקה" }, version: { version: 1, actionLevel: "DRAFT", blocks: [block], params, requirements: REQ }, installation: { id: "i1", values: { key: "smtp-password" }, userName: "Ariel" }, clients: [] }).text;
    expect(text).toContain("שלח מ-Gmail ops עם [סוד: smtp-password, נקרא מהכספת].");
  });
});

describe("a sending agent", () => {
  it("needs a NUMBER parameter before it can be approved", () => {
    const problems = versionProblems({ blocks: [block], params, actionLevel: "SEND" });
    expect(problems.map((p) => p.code)).toContain("sendNeedsQuota");
    const withQuota = versionProblems({ blocks: [block], params: [...params, { key: "quota", label: "מכסה יומית", level: "AGENT", type: "NUMBER", required: true, default: "20", clientField: null }], actionLevel: "SEND" });
    expect(withQuota.map((p) => p.code)).not.toContain("sendNeedsQuota");
    expect(versionProblems({ blocks: [block], params, actionLevel: "DRAFT" }).map((p) => p.code)).not.toContain("sendNeedsQuota");
  });
});

describe("the change note prompt", () => {
  it("is built from the differences, asks for one plain Hebrew line, and has no long dash", () => {
    const before = { blocks: [block], params, actionLevel: "DRAFT" };
    const after = { blocks: [{ ...block, body: "שלח מ-{{mail}} עם {{key}}, עד 20 ביום." }], params, actionLevel: "SEND" };
    const prompt = changeNotePrompt({ agentName: "מגייס", before, after });
    expect(prompt).toContain('מה השתנה בסוכן "מגייס" ולמה');
    expect(prompt).toContain("+ שלח מ-{{mail}} עם {{key}}, עד 20 ביום.");
    expect(prompt).toContain("- שלח מ-{{mail}} עם {{key}}.");
    expect(prompt).toContain("רמת הפעולה השתנתה מ-DRAFT ל-SEND.");
    expect(prompt).not.toMatch(/[\u2013\u2014]/);
  });
});
