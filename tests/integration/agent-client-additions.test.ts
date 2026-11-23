import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createInstallation, saveDraft } from "@/lib/app-domain/agents";
import { approveClientAddition, rejectClientAddition, saveClientAddition, submitClientAddition } from "@/lib/app-domain/agent-client-additions";
import { collectApprovals } from "@/lib/app-domain/approvals";
import { decideApproval } from "@/lib/app-domain/decide-approval";
import { parseBlocks, type AgentBlock } from "@/lib/agents/model";

// Client additions versioned on their own (24.11.2026). What is worth
// holding: NUX's rule changes without a new agent version, through a
// draft a manager approves; an installation on NUX reads "גרסה 1 + NUX 2";
// a block replaces an agent block only where the owners allowed it; a
// "בלי AI" client and a client without access are refused; and the
// migration moves the legacy client blocks, library links and all.

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
  { key: "role", kind: "role", title: "תפקיד", body: "אתה סוכן המייל." },
  { key: "tone", kind: "language", title: "טון", body: "כותבים בגוף ראשון.", overridable: true },
  { key: "never", kind: "rules", title: "לעולם לא", body: "לעולם לא שולחים.", safety: true },
];

async function setup() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const nux = await createTestClient({ name: "NUX" });
  const secret = await createTestClient({ name: "Hidden" });
  const other = await createTestClient({ name: "Other" });
  await prisma.client.update({ where: { id: secret.id }, data: { aiExcluded: true } });
  for (const c of [nux, secret]) await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: c.id } });
  const agent = await prisma.agent.create({ data: { slug: "mail", name: "Mail", purpose: "מטפל במייל", kind: "SCHEDULED", versions: { create: { version: 1, state: "APPROVED", blocks: BLOCKS } } } });
  return { hadas, ariel, nux, secret, other, agent };
}

describe("client additions", () => {
  it("versions a client's rule apart from the agent, through a manager's approval", async () => {
    const { hadas, ariel, nux, agent } = await setup();
    const inst = await createInstallation(hadas, { agentId: agent.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });

    const v1 = await saveClientAddition(hadas, { agentId: agent.id, clientId: nux.id, blocks: [{ key: "inv", kind: "rules", title: "חשבוניות", body: "חשבונית של NUX עוברת לאורן." }] });
    expect(v1.version).toBe(1);
    await expect(submitClientAddition(hadas, v1.id)).rejects.toThrow(/מה השתנה/);
    await saveClientAddition(hadas, { agentId: agent.id, clientId: nux.id, changeNote: "כלל חשבוניות ל-NUX" });
    await submitClientAddition(hadas, v1.id);
    // Waiting: nothing reaches the installation, and no second draft opens.
    expect((await call(hadas, "get_agent", { installation: inst.id })).text).not.toContain("לאורן");
    await expect(saveClientAddition(hadas, { agentId: agent.id, clientId: nux.id, changeNote: "עוד" })).rejects.toThrow(/ממתינה לאישור/);
    await expect(approveClientAddition(hadas, v1.id)).rejects.toThrow();

    // The approvals screen shows it with its client and its diff, and deciding there approves it.
    const row = (await collectApprovals(ariel)).find((r) => r.id === v1.id);
    expect(row).toMatchObject({ kind: "agent", clientId: nux.id, title: "Mail: תוספת לNUX, גרסה 1" });
    expect(row?.preview?.sections[0].lines).toEqual(["נוסף: חשבוניות", "+ חשבונית של NUX עוברת לאורן."]);
    await decideApproval(ariel, { kind: "agent", id: v1.id, decision: "approve" });

    const got = await call(hadas, "get_agent", { installation: inst.id });
    expect(got.text).toContain("גרסה 1 + NUX 1");
    expect(got.text).toContain("חשבונית של NUX עוברת לאורן.");

    // Version 2 replaces the agent's tone for NUX. The agent stays on version 1.
    const v2 = await saveClientAddition(hadas, { agentId: agent.id, clientId: nux.id, blocks: [...parseBlocks(v1.blocks), { key: "t", kind: "language", title: "טון ל-NUX", body: "כותבים בגוף שני.", replaces: "tone" }], changeNote: "טון אחר ל-NUX" });
    expect(v2.version).toBe(2);
    await submitClientAddition(hadas, v2.id);
    await approveClientAddition(ariel, v2.id);
    const after = await call(hadas, "get_agent", { installation: inst.id });
    expect(after.text).toContain("גרסה 1 + NUX 2");
    expect(after.text).toContain("כותבים בגוף שני.");
    expect(after.text).not.toContain("כותבים בגוף ראשון.");
    expect(after.text).not.toContain("עדכון זמין");
    expect(await prisma.agentVersion.count({ where: { agentId: agent.id } })).toBe(1);

    // A rejection needs a reason, and leaves version 2 in use.
    const v3 = await saveClientAddition(hadas, { agentId: agent.id, clientId: nux.id, blocks: [], changeNote: "להסיר הכל" });
    await submitClientAddition(hadas, v3.id);
    await expect(rejectClientAddition(ariel, v3.id, " ")).rejects.toThrow(/למה/);
    await rejectClientAddition(ariel, v3.id, "לא עכשיו");
    expect((await call(hadas, "get_agent", { installation: inst.id })).text).toContain("גרסה 1 + NUX 2");
  });

  it("refuses replacing a block the owners did not allow, and a safety block", async () => {
    const { hadas, nux, agent } = await setup();
    const row = await saveClientAddition(hadas, { agentId: agent.id, clientId: nux.id, blocks: [{ key: "x", kind: "rules", title: "שולחים", body: "ל-NUX מותר לשלוח.", replaces: "never" }], changeNote: "ניסיון" });
    await expect(submitClientAddition(hadas, row.id)).rejects.toThrow(/גבול בטיחות/);
  });

  it("refuses a client without access and a \"no AI\" client, on the screen and through the connector", async () => {
    const { hadas, secret, other, agent } = await setup();
    await expect(saveClientAddition(hadas, { agentId: agent.id, clientId: other.id, blocks: [] })).rejects.toThrow(/אין לך גישה/);
    await expect(saveClientAddition(hadas, { agentId: agent.id, clientId: secret.id, blocks: [] })).rejects.toThrow(/בלי AI/);
    const hidden = await call(hadas, "save_agent_client_addition", { agent: "mail", client: "Hidden", blocks: [] });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toContain("בלי AI");
    const unknown = await call(hadas, "save_agent_client_addition", { agent: "mail", client: "Other", blocks: [] });
    expect(unknown.text).toContain("No client you can access");
  });

  it("saves and submits an addition from Claude, with the problems still to fix", async () => {
    const { hadas, ariel, nux, agent } = await setup();
    const draft = await call(hadas, "save_agent_client_addition", { agent: "mail", client: "nux", blocks: [{ key: "x", kind: "rules", title: "קבוע", body: "טקסט.", replaces: "role" }] });
    expect(draft.isError).toBeFalsy();
    expect(draft.json).toMatchObject({ saved: true, client: "NUX", version: 1 });
    expect(draft.json.problems.join(" ")).toContain("ניתן להחלפה ללקוח");
    const sent = await call(hadas, "save_agent_client_addition", { agent: "mail", client: "NUX", blocks: [{ key: "x", kind: "rules", title: "קבוע", body: "טקסט." }], changeNote: "כלל ל-NUX", submit: true });
    expect(sent.json).toMatchObject({ saved: true, version: 1, state: expect.stringContaining("pending") });
    const listed = await call(ariel, "list_approvals", { everyone: true });
    expect(listed.text).toContain("Mail: תוספת לNUX");
    expect(listed.text).toContain("+ טקסט.");
    const row = await prisma.agentClientAddition.findFirstOrThrow({ where: { agentId: agent.id, clientId: nux.id } });
    const decided = await call(ariel, "decide_approval", { kind: "agent", id: row.id, decision: "approve" });
    expect(decided.isError).toBeFalsy();
    expect((await prisma.agentClientAddition.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("APPROVED");
  });

  it("marks a block overridable from Claude, and drops nothing else", async () => {
    const { hadas, agent } = await setup();
    const r = await call(hadas, "save_agent_draft", { agent: "mail", blocks: [{ key: "role", kind: "role", title: "תפקיד", body: "אתה סוכן המייל.", overridable: true }] });
    expect(r.isError).toBeFalsy();
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    expect(parseBlocks(draft.blocks)[0].overridable).toBe(true);
  });
});

describe("moving legacy client blocks into additions", () => {
  // The data part of the migration, run again on rows written the old way.
  const sql = readFileSync("prisma/migrations/20261124090000_agent_client_additions/migration.sql", "utf8");
  const statements = sql.slice(sql.indexOf("-- Data:")).split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.replace(/--.*$/gm, "").trim());

  it("keeps the rule and its library link, keeps a changed draft as a draft, and the agent compiles it once", async () => {
    const { hadas, nux } = await setup();
    const rule: AgentBlock = { key: "nux_rule", kind: "rules", title: "כתיבה בעברית בלי מקפים", body: "בלי מקפים.", clientId: nux.id, sharedKey: "hebrew-no-dashes", sharedVersion: 1 };
    const legacy = await prisma.agent.create({ data: { slug: "legacy-mail", name: "Legacy", purpose: "מייל", kind: "SCHEDULED", versions: { create: [{ version: 1, state: "APPROVED", blocks: [...BLOCKS, rule] }, { version: 2, state: "DRAFT", blocks: [...BLOCKS, { ...rule, body: "בלי מקפים בכלל." }] }] } } });
    const inst = await createInstallation(hadas, { agentId: legacy.id, surface: "SCHEDULED", clientScope: "ONE", clientIds: [nux.id], checkEvery: "RUN" });
    expect((await call(hadas, "get_agent", { installation: inst.id })).text).toContain("ללקוח NUX: כתיבה בעברית בלי מקפים");

    for (const s of statements) await prisma.$executeRawUnsafe(s);

    const rows = await prisma.agentClientAddition.findMany({ where: { agentId: legacy.id }, orderBy: { version: "asc" } });
    expect(rows.map((r) => [r.version, r.state])).toEqual([[1, "APPROVED"], [2, "DRAFT"]]);
    expect(parseBlocks(rows[0].blocks)).toEqual([{ key: "nux_rule", kind: "rules", title: "כתיבה בעברית בלי מקפים", body: "בלי מקפים.", sharedKey: "hebrew-no-dashes", sharedVersion: 1 }]);
    expect(parseBlocks(rows[1].blocks)[0].body).toBe("בלי מקפים בכלל.");
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: legacy.id, version: 2 } });
    expect(parseBlocks(draft.blocks).some((b) => b.clientId)).toBe(false);

    const got = (await call(hadas, "get_agent", { installation: inst.id })).text;
    expect(got).toContain("גרסה 1 + NUX 1");
    expect(got.match(/בלי מקפים\./g)).toHaveLength(1);

    // A new agent draft no longer copies the client block in.
    await prisma.agentVersion.delete({ where: { id: draft.id } });
    const next = await saveDraft(hadas, legacy.id, { changeNote: "טיוטה חדשה" });
    expect(parseBlocks(next.blocks).some((b) => b.clientId)).toBe(false);
  });
});
