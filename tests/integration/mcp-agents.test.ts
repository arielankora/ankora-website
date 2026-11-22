import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { approveVersion, createInstallation, saveDraft, setClientValue, submitDraft } from "@/lib/app-domain/agents";
import { collectApprovals } from "@/lib/app-domain/approvals";
import type { AgentBlock } from "@/lib/agents/model";

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
