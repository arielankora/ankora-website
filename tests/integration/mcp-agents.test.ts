import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { approveVersion, archiveAgent, createInstallation, listAgents, markFaulty, removeInstallation, revertToVersion, saveDraft, setAgentProcess, setAgentPurpose, setClientValue, submitDraft } from "@/lib/app-domain/agents";
import { collectApprovals } from "@/lib/app-domain/approvals";
import type { AgentBlock } from "@/lib/agents/model";
import { approveSharedVersion, listLessons, proposeSharedBlock, sharedBlockForAgent } from "@/lib/app-domain/agent-library";
import { parseBlocks } from "@/lib/agents/model";

// Agents, phase 1 (22.11.2026). What is worth holding: a draft saved from
// Claude waits for a manager; an installation gets the pinned version with
// its client's values filled in and never sees a "בלי AI" client; a newer
// version is offered with its change note, or taken silently when it
// changes nothing for that installation; and nobody fetches another
// person's installation.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text, isError: result.isError };
  } catch {
    return { json: null, text, isError: result.isError };
  }
}

const BLOCKS: AgentBlock[] = [
  { key: "role", kind: "role", title: "תפקיד", body: "אתה סוכן הלקוח של אנקורה." },
  { key: "sig", kind: "language", title: "חתימה", body: "חתום תמיד {{חתימה}}." },
];
const PARAMS = [{ key: "חתימה", label: "חתימה", level: "CLIENT", required: true }];

async function setup() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const nux = await createTestClient({ name: "NUX" });
  const rimed = await createTestClient({ name: "Rimed" });
  const secret = await createTestClient({ name: "Hidden" });
  await prisma.client.update({ where: { id: secret.id }, data: { aiExcluded: true } });
  for (const c of [nux, rimed, secret]) await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: c.id } });
  return { hadas, ariel, nux, rimed, secret };
}

describe("agents through the connector", () => {
  it("saves a draft from Claude that only a manager's approval puts in use", async () => {
    const { hadas, ariel } = await setup();
    const r = await call(hadas, "save_agent_draft", { create: { name: "Client agent", purpose: "מטפל בבקשות של לקוח", kind: "CLIENT_PROJECT" }, blocks: BLOCKS, params: PARAMS, submit: true });
    expect(r.isError).toBeFalsy();
    // No change note yet: saved, not sent.
    expect(r.json).toMatchObject({ saved: true, version: 1 });
    const agent = await prisma.agent.findFirstOrThrow({ where: { name: "Client agent" } });
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id } });
    expect(draft.state).toBe("DRAFT");
    await expect(submitDraft(hadas, draft.id)).rejects.toThrow(/מה השתנה/);

    const sent = await call(hadas, "save_agent_draft", { agent: agent.slug, changeNote: "גרסה ראשונה", submit: true });
    expect(sent.json).toMatchObject({ saved: true, version: 1, state: expect.stringContaining("pending") });
    expect((await collectApprovals(ariel)).some((row) => row.kind === "agent" && row.id === draft.id)).toBe(true);
    await expect(approveVersion(hadas, draft.id)).rejects.toThrow();
    await approveVersion(ariel, draft.id);
    expect((await prisma.agentVersion.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe("APPROVED");
  });

  it("compiles the pinned version for the installation's clients, offers updates and takes silent ones", async () => {
    const { hadas, ariel, nux, rimed, secret } = await setup();
    const agent = await prisma.agent.create({ data: { slug: "client-agent", name: "Client agent", purpose: "מטפל בבקשות", kind: "CLIENT_PROJECT", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS } } } });
    await setClientValue(hadas, { agentId: agent.id, clientId: nux.id, key: "חתימה", value: "הדס, NUX" });
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "PROJECT", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });

    const first = await call(hadas, "get_agent", { installation: inst.id });
    expect(first.isError).toBeFalsy();
    expect(first.text).toContain("חתום תמיד הדס, NUX.");
    expect(first.text).not.toContain("עדכון זמין");

    // A whole-scope installation never sees the "no AI" client, and a client without a signature is stopped.
    const all = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ALL_MINE", clientIds: [], checkEvery: "RUN" });
    const many = await call(hadas, "get_agent", { installation: all.id });
    expect(many.text).toContain("| NUX | הדס, NUX |");
    expect(many.text).toContain("אל תעבוד על Rimed");
    expect(many.text).not.toContain("Hidden");
    const refused = await call(hadas, "get_agent_client_context", { installation: all.id, client: secret.name });
    expect(refused.isError).toBe(true);

    // Version 2 adds a block only for Rimed: nothing changes for NUX, so it is taken without asking.
    await saveDraft(hadas, agent.id, { blocks: [...BLOCKS, { key: "rimed", kind: "rules", title: "Rimed", body: "באנגלית בלבד.", clientId: rimed.id }], changeNote: "כלל ל-Rimed" });
    const v2 = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 2 } });
    await submitDraft(hadas, v2.id);
    await approveVersion(ariel, v2.id);
    const silent = await call(hadas, "get_agent", { installation: inst.id });
    expect(silent.text).not.toContain("עדכון זמין");
    expect((await prisma.agentInstallation.findUniqueOrThrow({ where: { id: inst.id } })).pinnedVersionId).toBe(v2.id);

    // Version 3 changes a general block: offered with its note, and taken only through accept_agent_update.
    await saveDraft(hadas, agent.id, { blocks: [{ ...BLOCKS[0], body: "אתה סוכן הלקוח של אנקורה. ענה קצר." }, BLOCKS[1]], changeNote: "תשובות קצרות" });
    const v3 = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 3 } });
    await submitDraft(hadas, v3.id);
    await approveVersion(ariel, v3.id);
    const offered = await call(hadas, "get_agent", { installation: inst.id });
    expect(offered.text).toContain("עדכון זמין");
    expect(offered.text).toContain("גרסה 3: תשובות קצרות");
    expect(offered.text).not.toContain("ענה קצר");
    const accepted = await call(hadas, "accept_agent_update", { installation: inst.id, version: 3 });
    expect(accepted.json).toMatchObject({ updated: true, version: 3 });
    const after = await call(hadas, "get_agent", { installation: inst.id });
    expect(after.text).toContain("ענה קצר");
    expect(after.text).not.toContain("עדכון זמין");

    // Someone else's installation is refused in the domain's words.
    const other = await call(ariel, "get_agent", { installation: inst.id });
    expect(other.isError).toBe(true);
    expect(other.text).toContain("שייכת למישהו אחר");
  });

  it("refuses a secret in a draft", async () => {
    const { hadas } = await setup();
    const r = await call(hadas, "save_agent_draft", { create: { name: "Leaky", purpose: "בדיקה", kind: "SKILL" }, blocks: [{ key: "a", kind: "rules", title: "גישה", body: "הטוקן הוא ghp_1234567890abcdefghijklmnopqrstuvwxyzAB" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("סודות לא נכתבים");
  });
});

describe("agents, phase 2", () => {
  it("records runs, tells the owner about a failed one once, and lists the user's installations", async () => {
    const { hadas, nux } = await setup();
    const agent = await prisma.agent.create({ data: { slug: "runner", name: "Runner", purpose: "בדיקה", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS, params: [...PARAMS, { key: "תווית", label: "מזהה תווית", level: "INSTALLATION" }] } } } });
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "DAILY" });

    const fetched = await call(hadas, "get_agent", { installation: inst.id });
    expect(fetched.text).toContain("record_agent_run");

    const ok = await call(hadas, "record_agent_run", { installation: inst.id, outcome: "OK", summary: "מוינו 12 שרשורים" });
    expect(ok.json).toMatchObject({ recorded: true, version: 1 });
    await call(hadas, "record_agent_run", { installation: inst.id, outcome: "FAILED", summary: "לא נקרא", missing: ["Gmail"] });
    await call(hadas, "record_agent_run", { installation: inst.id, outcome: "FAILED", summary: "שוב לא נקרא" });
    const notes = await prisma.notification.findMany({ where: { userId: hadas.id, type: "agent.run_failed" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ entityType: "Agent", entityId: "runner" });
    expect(notes[0].body).toContain("חסר: Gmail");

    const saved = await call(hadas, "set_agent_installation_value", { installation: inst.id, key: "תווית", value: "Label_7" });
    expect(saved.json).toMatchObject({ saved: true });
    const notParam = await call(hadas, "set_agent_installation_value", { installation: inst.id, key: "חתימה", value: "x" });
    expect(notParam.isError).toBe(true);

    const mine = await call(hadas, "list_my_agents", {});
    expect(mine.json.installations).toHaveLength(1);
    expect(mine.json.installations[0]).toMatchObject({ installation: inst.id, version: 1, latestVersion: 1, updateWaiting: false, lastRun: { outcome: "FAILED" } });
  });

  it("moves every installation off a version marked faulty, and tells a scheduled owner about a waiting update", async () => {
    const { hadas, ariel, nux } = await setup();
    const agent = await prisma.agent.create({ data: { slug: "faulty", name: "Faulty", purpose: "בדיקה", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS } } } });
    await setClientValue(hadas, { agentId: agent.id, clientId: nux.id, key: "חתימה", value: "הדס" });
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });

    await saveDraft(hadas, agent.id, { blocks: [{ ...BLOCKS[0], body: "גרסה שבורה." }, BLOCKS[1]], changeNote: "שינוי" });
    const v2 = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 2 } });
    await submitDraft(hadas, v2.id);
    await approveVersion(ariel, v2.id);

    // Scheduled: not asked, the owner is told once.
    const waiting = await call(hadas, "get_agent", { installation: inst.id });
    expect(waiting.text).toContain("עדכון ממתין");
    await call(hadas, "get_agent", { installation: inst.id });
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: "agent.update_waiting" } })).toBe(1);

    // The owner takes it, then a manager marks it faulty: back to 1 at once.
    await call(hadas, "accept_agent_update", { installation: inst.id, version: 2 });
    await expect(markFaulty(hadas, v2.id, "שובר")).rejects.toThrow();
    await markFaulty(ariel, v2.id, "שובר את המיון");
    expect((await prisma.agentInstallation.findUniqueOrThrow({ where: { id: inst.id } })).pinnedVersionId).not.toBe(v2.id);
    const back = await call(hadas, "get_agent", { installation: inst.id });
    expect(back.text).toContain("גרסה 1");
    expect(back.text).not.toContain("גרסה שבורה");

    // The only approved version left cannot be marked faulty.
    const v1 = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 1 } });
    await expect(markFaulty(ariel, v1.id, "גם")).rejects.toThrow(/אין גרסה מאושרת אחרת/);
  });
});

describe("agents, phase 3", () => {
  it("writes an approved library version into every agent that copies it, past an open draft", async () => {
    const { hadas, ariel } = await setup();
    const first = await proposeSharedBlock(hadas, { title: "כתיבה בעברית", kind: "language", body: "עברית, משפטים קצרים." });
    await approveSharedVersion(ariel, first.version.id);
    const lib = await sharedBlockForAgent(first.block.key);
    const agent = await prisma.agent.create({ data: { slug: "uses-lib", name: "Uses lib", purpose: "בדיקה", kind: "SKILL", versions: { create: { version: 1, state: "APPROVED", blocks: [BLOCKS[0], lib] } } } });
    await saveDraft(hadas, agent.id, { blocks: [BLOCKS[0], lib, { key: "extra", kind: "rules", title: "עוד", body: "כלל בטיוטה." }] });

    const second = await proposeSharedBlock(hadas, { key: first.block.key, title: "כתיבה בעברית", kind: "language", body: "עברית, משפטים קצרים, בלי מקפים.", changeNote: "גם בלי מקפים" });
    await expect(approveSharedVersion(hadas, second.version.id)).rejects.toThrow();
    const { touched } = await approveSharedVersion(ariel, second.version.id);
    expect(touched).toEqual(["uses-lib"]);

    const versions = await prisma.agentVersion.findMany({ where: { agentId: agent.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.state])).toEqual([[1, "APPROVED"], [2, "APPROVED"], [3, "DRAFT"]]);
    expect(versions[1].changeNote).toContain("גם בלי מקפים");
    for (const v of versions.slice(1)) expect(parseBlocks(v.blocks).find((b) => b.sharedKey === first.block.key)?.body).toBe("עברית, משפטים קצרים, בלי מקפים.");
    expect(parseBlocks(versions[2].blocks).some((b) => b.key === "extra")).toBe(true);
  });

  it("installs from Claude, takes a lesson from a run, and exports nothing secret", async () => {
    const { hadas, nux } = await setup();
    await prisma.agent.create({ data: { slug: "installable", name: "Installable", purpose: "בדיקה", kind: "CLIENT_PROJECT", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS } } } });
    const r = await call(hadas, "install_agent", { agent: "installable", surface: "PROJECT", clients: [nux.name] });
    expect(r.json).toMatchObject({ installed: true });
    expect(r.json.bootstrap).toContain(r.json.installation);
    const wrong = await call(hadas, "install_agent", { agent: "installable", surface: "PROJECT", clients: ["No such client"] });
    expect(wrong.isError).toBeFalsy();
    expect(wrong.text).toContain("Nothing was installed");

    const lesson = await call(hadas, "propose_agent_change", { installation: r.json.installation, lesson: "להוסיף כלל: לא לענות בשבת", block: "role" });
    expect(lesson.json).toMatchObject({ proposed: true });
    const agent = await prisma.agent.findUniqueOrThrow({ where: { slug: "installable" } });
    expect((await listLessons(hadas, agent.id)).map((l) => l.text)).toEqual(["להוסיף כלל: לא לענות בשבת"]);
  });
});

describe("archiving an agent", () => {
  it("is a manager's call with a reason, waits for its installations, and takes it out of every list and the connector", async () => {
    const { hadas, ariel, nux } = await setup();
    const agent = await prisma.agent.create({ data: { slug: "old-report", name: "Old report", purpose: "דוח ישן", kind: "SCHEDULED", versions: { create: [{ version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS }, { version: 2, state: "PENDING", blocks: BLOCKS, params: PARAMS, changeNote: "שינוי", submittedAt: new Date() }] } }, include: { versions: true } });
    const pending = agent.versions.find((v) => v.version === 2)!;
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });

    await expect(archiveAgent(hadas, agent.id, "לא בשימוש")).rejects.toThrow();
    await expect(archiveAgent(ariel, agent.id, " ")).rejects.toMatchObject({ code: "agents.reasonRequired" });
    await expect(archiveAgent(ariel, agent.id, "לא בשימוש")).rejects.toMatchObject({ code: "agents.archiveInstalled" });

    await removeInstallation(hadas, inst.id);
    await archiveAgent(ariel, agent.id, "לא בשימוש");

    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).archivedAt).not.toBeNull();
    expect((await listAgents(hadas)).some((a) => a.id === agent.id)).toBe(false);
    expect((await collectApprovals(ariel)).some((row) => row.kind === "agent" && row.id === pending.id)).toBe(false);
    const draft = await call(hadas, "save_agent_draft", { agent: "old-report", changeNote: "עוד שינוי" });
    expect(draft.text).toContain("No agent with the slug");
    await expect(archiveAgent(ariel, agent.id, "שוב")).rejects.toMatchObject({ code: "agents.notFound" });
  });
});

describe("files attached to an agent", () => {
  it("saves them from Claude, lists them in get_agent, returns one by path, and refuses a secret in one", async () => {
    const { hadas, ariel, nux } = await setup();
    const script = "import csv\nprint('hello')\n";
    const saved = await call(hadas, "save_agent_draft", {
      create: { name: "Campaign", purpose: "קמפיין פניות", kind: "SKILL" },
      blocks: [{ key: "steps", kind: "steps", title: "צעדים", body: "הרץ את scripts/build.py." }],
      files: [{ path: "scripts/build.py", content: script }, { path: "assets/template.md", content: "# תבנית" }],
      changeNote: "ייבוא",
      submit: true,
    });
    expect(saved.isError).toBeFalsy();
    const agent = await prisma.agent.findFirstOrThrow({ where: { name: "Campaign" } });
    const v = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id } });
    await approveVersion(ariel, v.id);
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SKILL", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });

    const got = await call(hadas, "get_agent", { installation: inst.id });
    expect(got.text).toContain("## קבצים מצורפים");
    expect(got.text).toContain("- scripts/build.py");
    expect(got.text).toContain(`get_agent_file עם installation ${inst.id}`);

    const file = await call(hadas, "get_agent_file", { installation: inst.id, path: "scripts/build.py" });
    expect(file.isError).toBeFalsy();
    expect(file.text).toBe(script);
    const missing = await call(hadas, "get_agent_file", { installation: inst.id, path: "nope.txt" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("assets/template.md");
    const other = await call(ariel, "get_agent_file", { installation: inst.id, path: "scripts/build.py" });
    expect(other.isError).toBe(true);

    // A new draft keeps the files it did not touch.
    await saveDraft(hadas, agent.id, { changeNote: "רק הערה" });
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    expect((draft.files as { path: string }[]).map((f) => f.path)).toEqual(["scripts/build.py", "assets/template.md"]);

    const leaky = await call(hadas, "save_agent_draft", { agent: agent.slug, files: [{ path: "config.env", content: "TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyzAB" }] });
    expect(leaky.isError).toBe(true);
    expect(leaky.text).toContain("סודות לא נכתבים");
    const escape = await call(hadas, "save_agent_draft", { agent: agent.slug, files: [{ path: "../etc/passwd", content: "x" }] });
    expect(escape.isError).toBe(true);
  });
});

describe("an agent that carries out a process", () => {
  it("gets the approved procedure in get_agent, follows a newly approved one, and says why when it cannot", async () => {
    const { hadas, ariel, nux, secret } = await setup();
    await prisma.userClientAccess.create({ data: { userId: ariel.id, clientId: nux.id } });
    const proc = await prisma.process.create({ data: { clientId: nux.id, seq: 9, code: "P9", title: "דוח יומי", status: "ACTIVE" } });
    const agent = await prisma.agent.create({ data: { slug: "daily-report", name: "Daily report", purpose: "דוח יומי", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS } } } });
    await setClientValue(hadas, { agentId: agent.id, clientId: nux.id, key: "חתימה", value: "הדס" });
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });

    await expect(setAgentProcess(hadas, agent.id, proc.id)).rejects.toThrow();
    await setAgentProcess(ariel, agent.id, proc.id);

    // Linked, no approved procedure yet: get_agent says so.
    const before = await call(hadas, "get_agent", { installation: inst.id });
    expect(before.text).toContain("ל" + "P9 דוח יומי אין עדיין נוהל מאושר");

    await prisma.processVersion.create({ data: { processId: proc.id, version: 1, status: "APPROVED", steps: [{ title: "אוספים את הסטטוס", output: "טבלה", verification: "יש שורה לכל משימה" }, { title: "שולחים לאריאל", requiresApproval: true }] } });
    const after = await call(hadas, "get_agent", { installation: inst.id });
    expect(after.text).toContain("## הנוהל: P9 דוח יומי (NUX, גרסה 1)");
    expect(after.text).toContain("1. אוספים את הסטטוס");
    expect(after.text).toContain("   - תוצר: טבלה");
    expect(after.text).toContain("2. שולחים לאריאל (באישור אדם)");

    // A process of a "no AI" client is never sent.
    const hidden = await prisma.process.create({ data: { clientId: secret.id, seq: 1, code: "P1", title: "סודי", status: "ACTIVE" } });
    await prisma.processVersion.create({ data: { processId: hidden.id, version: 1, status: "APPROVED", steps: [{ title: "שלב סודי" }] } });
    await prisma.agent.update({ where: { id: agent.id }, data: { processId: hidden.id } });
    const excluded = await call(hadas, "get_agent", { installation: inst.id });
    expect(excluded.text).not.toContain("שלב סודי");
    expect(excluded.text).toContain("בלי AI");

    await setAgentProcess(ariel, agent.id, null);
    const unlinked = await call(hadas, "get_agent", { installation: inst.id });
    expect(unlinked.text).not.toContain("## הנוהל");
  });
});

describe("an agent's description", () => {
  it("is changed in place by a manager, with an audit entry", async () => {
    const { hadas, ariel } = await setup();
    const agent = await prisma.agent.create({ data: { slug: "client-agent", name: "Client agent", purpose: "משימות ב-ClickUp", kind: "CLIENT_PROJECT", versions: { create: [{ version: 1, state: "APPROVED", blocks: BLOCKS, params: PARAMS }] } } });

    await expect(setAgentPurpose(hadas, agent.id, "משימות באנקורה")).rejects.toThrow();
    await expect(setAgentPurpose(ariel, agent.id, " ")).rejects.toMatchObject({ code: "agents.purposeRequired" });
    await setAgentPurpose(ariel, agent.id, "  משימות באנקורה ");

    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).purpose).toBe("משימות באנקורה");
    expect(await prisma.auditEvent.count({ where: { action: "agent.purpose", entityId: agent.id } })).toBe(1);
    expect((await listAgents(hadas)).find((a) => a.id === agent.id)?.purpose).toBe("משימות באנקורה");
  });
});

describe("going back to an earlier version", () => {
  it("opens a copy of it as the next version, through approval, and refuses while another is open", async () => {
    const { hadas, ariel, nux } = await setup();
    const lib = { key: "lib", kind: "language" as const, title: "כתיבה", body: "עברית.", sharedKey: "hebrew" };
    const files = [{ path: "t.md", content: "תבנית" }];
    const agent = await prisma.agent.create({ data: { slug: "reverts", name: "Reverts", purpose: "בדיקה", kind: "SKILL", versions: { create: { version: 1, state: "APPROVED", actionLevel: "DRAFT", blocks: [...BLOCKS, lib], params: PARAMS, files, requirements: { connectors: ["Gmail"] } } } } });
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "PROJECT", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });
    const v2 = await saveDraft(hadas, agent.id, { blocks: [BLOCKS[0]], params: [], files: [], actionLevel: "READ", changeNote: "קצר יותר" });
    await submitDraft(hadas, v2.id);
    await approveVersion(ariel, v2.id);

    // Not to the version in use, and not while a draft is open.
    await expect(revertToVersion(hadas, agent.id, 2)).rejects.toThrow(/בשימוש/);
    const open = await saveDraft(hadas, agent.id, { changeNote: "טיוטה" });
    await expect(revertToVersion(hadas, agent.id, 1)).rejects.toThrow(/טיוטה פתוחה/);
    await prisma.agentVersion.delete({ where: { id: open.id } });

    // From Claude: version 3 is a copy of 1, waiting for a manager.
    const r = await call(hadas, "revert_agent_to_version", { agent: agent.slug, version: 1, submit: true });
    expect(r.isError).toBeFalsy();
    expect(r.json).toMatchObject({ saved: true, version: 3, copyOf: 1, state: expect.stringContaining("pending") });
    const v1 = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 1 } });
    const v3 = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 3 } });
    expect(v3).toMatchObject({ state: "PENDING", changeNote: "חזרה לגרסה 1", actionLevel: "DRAFT", blocks: v1.blocks, params: v1.params, files: v1.files, requirements: v1.requirements });
    expect(parseBlocks(v3.blocks).find((b) => b.key === "lib")?.sharedKey).toBe("hebrew");
    expect(await prisma.auditEvent.count({ where: { action: "agent.revert", entityId: v3.id } })).toBe(1);

    // Pending: refused in the connector's words, not "unexpected error".
    const again = await call(hadas, "revert_agent_to_version", { agent: agent.slug, version: 1 });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("ממתינה לאישור");

    // Nothing moves before approval; after it, the installation is offered version 3.
    expect((await prisma.agentInstallation.findUniqueOrThrow({ where: { id: inst.id } })).pinnedVersionId).not.toBe(v3.id);
    await approveVersion(ariel, v3.id);
    expect((await listAgents(hadas)).find((a) => a.id === agent.id)?.version).toBe(3);
  });
});
