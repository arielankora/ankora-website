import { describe, expect, it } from "vitest";
import { bootstrapText, compileAgent, isCheckDue, type CompileInput } from "@/lib/agents/compile";
import type { AgentBlock, AgentParam } from "@/lib/agents/model";

// compile.ts beyond the happy path (test gaps, 23.11.2026): what Claude
// reads when a value is missing, when an installation covers several
// clients, when a library key is unknown, when an installation value
// overrides a default, and the attached files list.

const REQ = { connectors: [], skills: [], repos: [], localMcp: [], externalRunners: [] };
const agent = { name: "Client agent", slug: "client-agent", purpose: "מטפל בבקשות של לקוח" };

const p = (over: Partial<AgentParam> & Pick<AgentParam, "key" | "level">): AgentParam => ({ label: over.key, type: "TEXT", required: false, default: null, clientField: null, ...over });

function compile(over: { blocks?: AgentBlock[]; params?: AgentParam[]; files?: CompileInput["version"]["files"]; installation?: CompileInput["installation"]; clients?: CompileInput["clients"]; library?: CompileInput["library"]; actionLevel?: "READ" | "DRAFT" | "SEND" }) {
  return compileAgent({
    agent,
    version: { version: 4, actionLevel: over.actionLevel ?? "DRAFT", blocks: over.blocks ?? [], params: over.params ?? [], requirements: REQ, files: over.files },
    installation: over.installation === undefined ? { id: "inst1", values: {}, userName: "Hadas" } : over.installation,
    clients: over.clients ?? [],
    library: over.library,
  });
}

describe("a required value that is missing", () => {
  const params = [p({ key: "label", label: "תווית", level: "INSTALLATION", required: true })];
  const blocks: AgentBlock[] = [{ key: "r", kind: "rules", title: "תוויות", body: "סמן ב-{{label}}." }];

  it("tells Claude to stop when the installation has no value and no default", () => {
    const c = compile({ blocks, params });
    expect(c.missingInstallation).toEqual(["תווית"]);
    expect(c.text).toContain('להתקנה חסר ערך ל"תווית". עצור ודווח.');
    // The placeholder stays as written: nothing is invented in its place.
    expect(c.text).toContain("סמן ב-{{label}}.");
  });

  it("is not missing once the installation sets it, or the parameter has a default", () => {
    expect(compile({ blocks, params, installation: { id: "i", values: { label: "Ankora/Done" }, userName: "Hadas" } }).missingInstallation).toEqual([]);
    expect(compile({ blocks, params: [{ ...params[0], default: "Inbox" }] }).missingInstallation).toEqual([]);
  });

  it("stops a client without a required client value, and only that client", () => {
    const sig = p({ key: "sig", label: "חתימה", level: "CLIENT", required: true });
    const c = compile({ blocks: [{ key: "s", kind: "language", title: "חתימה", body: "{{sig}}" }], params: [sig], clients: [{ id: "a", name: "NUX", values: { sig: "הדס" } }, { id: "b", name: "Rimed", values: { sig: "" } }] });
    expect(c.blocked).toEqual([{ clientId: "b", clientName: "Rimed", missing: ["חתימה"] }]);
    expect(c.text).toContain('אל תעבוד על Rimed: חסר ערך ל"חתימה". דווח מה חסר.');
    expect(c.text).not.toContain("אל תעבוד על NUX");
  });

  it("has no \"חסר\" section when nothing is missing", () => {
    expect(compile({ blocks: [{ key: "r", kind: "role", title: "תפקיד", body: "סוכן." }] }).text).not.toContain("## חסר");
  });
});

describe("client values for an installation with several clients", () => {
  const params = [p({ key: "name", label: "שם הלקוח", level: "CLIENT", clientField: "name" }), p({ key: "domains", label: "דומיינים", level: "CLIENT", clientField: "domains", required: true })];
  const blocks: AgentBlock[] = [{ key: "r", kind: "rules", title: "מיילים", body: "רק מ-{{domains}}." }];
  const clients = [
    { id: "a", name: "NUX", values: { name: "NUX", domains: "nux.co.il, nux.com" } },
    { id: "b", name: "Rimed", values: { name: "Rimed", domains: "" } },
  ];

  it("points the placeholder to the table, and writes one row per client", () => {
    const c = compile({ blocks, params, clients });
    expect(c.text).toContain("רק מ-דומיינים (לפי לקוח, בטבלה למטה).");
    expect(c.text).toContain("## לפי לקוח");
    expect(c.text).toContain("| לקוח | שם הלקוח | דומיינים |");
    expect(c.text).toContain("| NUX | NUX | nux.co.il, nux.com |");
    expect(c.text).toContain("| Rimed | Rimed | חסר |");
    expect(c.text).toContain("get_agent_client_context");
    expect(c.blocked.map((b) => b.clientName)).toEqual(["Rimed"]);
    // Neither client is named in the header: the installation is not about one of them.
    expect(c.header).not.toContain("לקוח ");
  });

  it("fills the value in place, with no table, for one client", () => {
    const c = compile({ blocks, params, clients: [clients[0]] });
    expect(c.text).toContain("רק מ-nux.co.il, nux.com.");
    expect(c.text).not.toContain("## לפי לקוח");
    expect(c.header).toContain("· לקוח NUX");
  });

  it("takes a client parameter's default when the client has no value", () => {
    const tone = p({ key: "tone", label: "טון", level: "CLIENT", default: "רשמי" });
    const c = compile({ blocks: [{ key: "t", kind: "language", title: "טון", body: "{{tone}}" }], params: [tone], clients: [{ id: "a", name: "NUX", values: {} }, { id: "b", name: "Rimed", values: { tone: "חברי" } }] });
    expect(c.text).toContain("| NUX | רשמי |");
    expect(c.text).toContain("| Rimed | חברי |");
  });
});

describe("a library block parameter with an unknown key", () => {
  const voice = p({ key: "voice", label: "קול", level: "AGENT", type: "LIBRARY_BLOCK", default: "missing-voice" });
  const blocks: AgentBlock[] = [{ key: "v", kind: "language", title: "קול", body: "{{voice}}" }];

  it("says the block was not found, at agent level too, instead of leaving the key", () => {
    const text = compile({ blocks, params: [voice], library: { "ariel-voice": { title: "אריאל", body: "קצר." } } }).text;
    expect(text).toContain('[קטע הספרייה "missing-voice" לא נמצא או שאין לו גרסה מאושרת. דווח על כך.]');
  });

  it("says so as well when no library was passed at all", () => {
    expect(compile({ blocks, params: [voice] }).text).toContain('קטע הספרייה "missing-voice" לא נמצא');
  });

  it("finds a key written with spaces around it", () => {
    const text = compile({ blocks, params: [{ ...voice, default: " ariel-voice " }], library: { "ariel-voice": { title: "אריאל", body: "  קצר.  " } } }).text;
    expect(text).toContain("## קול\n\nקצר.");
  });
});

describe("installation values over defaults", () => {
  const params = [p({ key: "limit", label: "מכסה", level: "INSTALLATION", type: "NUMBER", default: "20" }), p({ key: "lang", label: "שפה", level: "AGENT", default: "עברית" })];
  const blocks: AgentBlock[] = [{ key: "q", kind: "rules", title: "מכסה", body: "עד {{limit}} הודעות, ב{{lang}}. {{unknown}}" }];

  it("uses the installation's value when it has one, the default when it does not", () => {
    expect(compile({ blocks, params, installation: { id: "i", values: { limit: "5" }, userName: "Hadas" } }).text).toContain("עד 5 הודעות, בעברית.");
    expect(compile({ blocks, params, installation: { id: "i", values: { limit: "" }, userName: "Hadas" } }).text).toContain("עד 20 הודעות");
    expect(compile({ blocks, params, installation: null }).text).toContain("עד 20 הודעות");
  });

  it("ignores an installation value for an agent-level parameter", () => {
    expect(compile({ blocks, params, installation: { id: "i", values: { lang: "English" }, userName: "Hadas" } }).text).toContain("בעברית.");
  });

  it("leaves a placeholder that is not a parameter as written", () => {
    expect(compile({ blocks, params }).text).toContain("{{unknown}}");
  });
});

describe("attached files", () => {
  const files = [
    { path: "scripts/build.py", content: "x".repeat(1234) },
    { path: "templates/reply.md", content: "שלום" },
  ];

  it("lists each path with its size, and how to read it with the installation id", () => {
    const text = compile({ files }).text;
    expect(text).toContain("## קבצים מצורפים");
    expect(text).toContain("- scripts/build.py (1,234 תווים)");
    expect(text).toContain("- templates/reply.md (4 תווים)");
    expect(text).toContain("get_agent_file עם installation inst1 והנתיב.");
  });

  it("says how to read them without an installation (the screen and the export)", () => {
    expect(compile({ files, installation: null }).text).toContain("Claude קורא אותם בכלי get_agent_file, לפי הנתיב.");
  });

  it("has no files section without files", () => {
    expect(compile({ files: [] }).text).not.toContain("קבצים מצורפים");
  });
});

describe("the rest of the compiled text", () => {
  it("orders general blocks by kind, whatever their order in the version", () => {
    const text = compile({ blocks: [{ key: "o", kind: "output", title: "פלט", body: "טבלה." }, { key: "r", kind: "role", title: "תפקיד", body: "סוכן." }, { key: "w", kind: "rules", title: "כללים", body: "בלי מקפים.", why: "סגנון הבית." }] }).text;
    expect(text.indexOf("## תפקיד")).toBeLessThan(text.indexOf("## כללים"));
    expect(text.indexOf("## כללים")).toBeLessThan(text.indexOf("## פלט"));
    expect(text).toContain("בלי מקפים.\n\nלמה: סגנון הבית.");
  });

  it("writes the action level in words, and every kind of requirement", () => {
    const c = compileAgent({ agent, version: { version: 1, actionLevel: "SEND", blocks: [], params: [], requirements: { connectors: ["Gmail"], skills: ["drive-search"], repos: ["ankora-website"], localMcp: ["files"], externalRunners: ["cron on mac"] } }, installation: null, clients: [] });
    expect(c.text).toContain("שולח בשם אדם, לפי הכללים והמכסות שכאן בלבד.");
    for (const line of ["חיבורים: Gmail", "סקילים: drive-search", "ריפואים: ankora-website", "MCP מקומי: files", "רכיבים חיצוניים: cron on mac"]) expect(c.text).toContain(`- ${line}`);
    expect(c.header).toBe("# Client agent\n\nגרסה 1\n");
    expect(compile({ actionLevel: "READ" }).text).toContain("קורא בלבד.");
  });

  it("names the installation and its owner in the header", () => {
    expect(compile({}).header).toContain("גרסה 4 · התקנה inst1 · עבור Hadas");
  });

  it("writes a vault parameter as a reference, once, however it was typed", () => {
    const key = p({ key: "key", label: "מפתח", level: "CLIENT", type: "VAULT_REF" });
    const text = compile({ blocks: [{ key: "k", kind: "tools", title: "גישה", body: "{{key}}" }], params: [key], clients: [{ id: "a", name: "NUX", values: { key: "[סוד: smtp, נקרא מהכספת]" } }] }).text;
    expect(text).toContain("## גישה\n\n[סוד: smtp, נקרא מהכספת]");
    expect(text).not.toContain("[סוד: [סוד:");
  });
});

describe("the bootstrap text and the update check", () => {
  it("names the installation and tells Claude to stop when the tool is missing", () => {
    const text = bootstrapText({ name: "Client agent" }, "inst9");
    expect(text).toContain('get_agent של Ankora עם installation "inst9"');
    expect(text).toContain("עצור ודווח");
  });

  it("is due every run, daily or weekly, with a minute of slack", () => {
    const now = new Date("2026-11-23T10:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const DAY = 24 * 60 * 60 * 1000;
    expect(isCheckDue("DAILY", null, now)).toBe(true);
    expect(isCheckDue("RUN", ago(1000), now)).toBe(true);
    expect(isCheckDue("DAILY", ago(DAY - 30_000), now)).toBe(true);
    expect(isCheckDue("DAILY", ago(DAY - 120_000), now)).toBe(false);
    expect(isCheckDue("WEEKLY", ago(6 * DAY), now)).toBe(false);
    expect(isCheckDue("WEEKLY", ago(7 * DAY), now)).toBe(true);
  });
});
