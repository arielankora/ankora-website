import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { parseBlocks, parseParams, type AgentBlock } from "@/lib/agents/model";

// The agents screens' server actions (test gaps, 23.11.2026): who may
// decide, and what the block and parameter forms do with what was typed.
// Every action goes through lib/app-domain/agents.ts, so these hold the
// wiring: the form fields, the friendly error, and nothing written on a
// refusal.

const session = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  const current = async () => {
    if (!session.user) throw new UnauthorizedError();
    return session.user;
  };
  return { UnauthorizedError, requireUser: current, requireUserOrThrow: current, getCurrentUser: async () => session.user };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import {
  approveVersionAction,
  archiveAgentAction,
  createAgentAction,
  markFaultyAction,
  rejectVersionAction,
  revertToVersionAction,
  saveBlockAction,
  saveMetaAction,
  saveParamAction,
  setAgentPurposeAction,
  setClientValueAction,
} from "@/app/(product)/app/(authenticated)/agents/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const as = (user: User) => {
  session.user = user;
};

const BLOCKS: AgentBlock[] = [{ key: "role", kind: "role", title: "תפקיד", body: "אתה סוכן של אנקורה." }];

async function setup() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const agent = await prisma.agent.create({
    data: {
      slug: "screens",
      name: "Screens",
      purpose: "בדיקה",
      kind: "SKILL",
      versions: {
        create: [
          { version: 1, state: "APPROVED", blocks: BLOCKS, params: [] },
          { version: 2, state: "APPROVED", blocks: [...BLOCKS, { key: "out", kind: "output", title: "פלט", body: "טבלה." }], params: [], changeNote: "פלט" },
        ],
      },
    },
    include: { versions: true },
  });
  return { hadas, ariel, agent, v1: agent.versions.find((v) => v.version === 1)!, v2: agent.versions.find((v) => v.version === 2)! };
}

async function pendingDraft(agentId: string, by: User) {
  as(by);
  await saveBlockAction(undefined, form({ agentId, title: "כללים", kind: "rules", body: "קצר." }));
  await saveMetaAction(undefined, form({ agentId, actionLevel: "DRAFT", changeNote: "כלל חדש" }));
  const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId, state: "DRAFT" } });
  await prisma.agentVersion.update({ where: { id: draft.id }, data: { state: "PENDING", submittedAt: new Date() } });
  return draft;
}

describe("what a team member may not decide on the agents screens", () => {
  it("cannot approve or reject a version: refused in words, and the version still waits", async () => {
    const { hadas, ariel, agent } = await setup();
    const draft = await pendingDraft(agent.id, hadas);

    as(hadas);
    const approve = await approveVersionAction(draft.id);
    expect(approve.ok).toBeUndefined();
    expect(approve.error).toBeTruthy();
    const reject = await rejectVersionAction(undefined, form({ id: draft.id, reason: "לא" }));
    expect(reject.error).toBeTruthy();
    expect((await prisma.agentVersion.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe("PENDING");

    as(ariel);
    expect(await approveVersionAction(draft.id)).toEqual({ ok: true });
    expect((await prisma.agentVersion.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe("APPROVED");
  });

  it("cannot archive an agent, mark a version faulty or change its description", async () => {
    const { hadas, ariel, agent, v2 } = await setup();
    as(hadas);
    expect((await archiveAgentAction(undefined, form({ agentId: agent.id, reason: "לא בשימוש" }))).error).toBeTruthy();
    expect((await markFaultyAction(undefined, form({ id: v2.id, reason: "שולח פעמיים" }))).error).toBeTruthy();
    expect((await setAgentPurposeAction(undefined, form({ agentId: agent.id, purpose: "משהו אחר" }))).error).toBeTruthy();
    const after = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id }, include: { versions: true } });
    expect(after.archivedAt).toBeNull();
    expect(after.purpose).toBe("בדיקה");
    expect(after.versions.every((v) => v.faultyAt === null)).toBe(true);

    // A manager is told what is missing, in the domain's words.
    as(ariel);
    expect(await archiveAgentAction(undefined, form({ agentId: agent.id, reason: " " }))).toEqual({ error: "צריך לכתוב בשורה אחת למה." });
    expect(await setAgentPurposeAction(undefined, form({ agentId: agent.id, purpose: "" }))).toEqual({ error: "צריך לכתוב בשורה מה הסוכן עושה." });
    expect(await setAgentPurposeAction(undefined, form({ agentId: agent.id, purpose: "משימות באנקורה" }))).toEqual({ ok: true });
    expect(await markFaultyAction(undefined, form({ id: v2.id, reason: "שולח פעמיים" }))).toEqual({ ok: true });
    expect(await archiveAgentAction(undefined, form({ agentId: agent.id, reason: "הוחלף" }))).toEqual({ ok: true });
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).archivedAt).not.toBeNull();
  });

  it("may go back to an earlier version only as a draft that a manager approves", async () => {
    const { hadas, ariel, agent } = await setup();
    as(hadas);
    expect(await revertToVersionAction(agent.id, 1)).toEqual({ ok: true, version: 3 });
    const copy = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, version: 3 } });
    expect(copy.state).toBe("DRAFT");
    // Not again while the copy is open, and not to the version in use.
    expect((await revertToVersionAction(agent.id, 1)).error).toBeTruthy();
    await prisma.agentVersion.update({ where: { id: copy.id }, data: { state: "PENDING", submittedAt: new Date() } });
    expect((await approveVersionAction(copy.id)).error).toBeTruthy();
    as(ariel);
    expect(await approveVersionAction(copy.id)).toEqual({ ok: true });
    expect((await revertToVersionAction(agent.id, 3)).error).toBe("גרסה 3 היא הגרסה שבשימוש.");
  });

  it("is refused before the action reads anything when nobody is signed in", async () => {
    const { agent } = await setup();
    session.user = null;
    await expect(saveBlockAction(undefined, form({ agentId: agent.id, title: "x", kind: "rules", body: "x" }))).rejects.toThrow("Unauthorized");
  });
});

describe("the block form", () => {
  it("adds a block with a generated key, and falls back to a rules block for an unknown kind", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    expect(await saveBlockAction(undefined, form({ agentId: agent.id, title: " כללים ", kind: "nonsense", body: " קצר. ", why: "" }))).toEqual({ ok: true });
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    const added = parseBlocks(draft.blocks).at(-1)!;
    expect(added).toMatchObject({ kind: "rules", title: "כללים", body: "קצר.", why: null, safety: false, overridable: false });
    expect(added.key).toMatch(/^b[0-9a-z]+$/);
    // The draft starts from the version in use, so nothing of it is lost.
    expect(parseBlocks(draft.blocks).map((b) => b.key).slice(0, 2)).toEqual(["role", "out"]);
  });

  it("never marks a safety block overridable", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    await saveBlockAction(undefined, form({ agentId: agent.id, key: "never", title: "גבול", kind: "rules", body: "לעולם לא שולחים.", safety: "on", overridable: "on" }));
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    expect(parseBlocks(draft.blocks).find((b) => b.key === "never")).toMatchObject({ safety: true, overridable: false });
  });

  it("edits a block in place by its original key", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    await saveBlockAction(undefined, form({ agentId: agent.id, originalKey: "role", title: "תפקיד", kind: "role", body: "אתה סוכן חדש." }));
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    const blocks = parseBlocks(draft.blocks);
    expect(blocks.map((b) => b.key)).toEqual(["role", "out"]);
    expect(blocks[0].body).toBe("אתה סוכן חדש.");
  });

  it("refuses a block without a title or with a bad key, and writes nothing", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    expect(await saveBlockAction(undefined, form({ agentId: agent.id, title: "  ", kind: "rules", body: "x" }))).toEqual({ error: "הטיוטה לא תקינה." });
    expect(await saveBlockAction(undefined, form({ agentId: agent.id, key: "two words", title: "כותרת", kind: "rules", body: "x" }))).toEqual({ error: "הטיוטה לא תקינה." });
    expect(await prisma.agentVersion.count({ where: { agentId: agent.id, state: "DRAFT" } })).toBe(0);
  });

  it("refuses a secret in a block", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    const r = await saveBlockAction(undefined, form({ agentId: agent.id, title: "גישה", kind: "tools", body: "הטוקן ghp_1234567890abcdefghijklmnopqrstuvwxyzAB" }));
    expect(r.error).toContain("סודות לא נכתבים");
  });
});

describe("the parameter form", () => {
  it("adds a parameter with what was typed, and the defaults for anything unknown", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    expect(await saveParamAction(undefined, form({ agentId: agent.id, key: "חתימה", label: "חתימה", level: "CLIENT", type: "LONG_TEXT", required: "on", default: "", clientField: "" }))).toEqual({ ok: true });
    expect(await saveParamAction(undefined, form({ agentId: agent.id, key: "tone", label: "טון", level: "GLOBAL", type: "COLOR", default: "רשמי", clientField: "phone" }))).toEqual({ ok: true });
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    expect(parseParams(draft.params)).toEqual([
      { key: "חתימה", label: "חתימה", level: "CLIENT", type: "LONG_TEXT", required: true, default: null, clientField: null },
      { key: "tone", label: "טון", level: "AGENT", type: "TEXT", required: false, default: "רשמי", clientField: null },
    ]);
  });

  it("takes a client field, and edits a parameter in place by its original key", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    await saveParamAction(undefined, form({ agentId: agent.id, key: "domains", label: "דומיינים", level: "CLIENT", type: "LIST", clientField: "domains" }));
    await saveParamAction(undefined, form({ agentId: agent.id, originalKey: "domains", key: "domains", label: "דומיינים של הלקוח", level: "CLIENT", type: "LIST", clientField: "domains", required: "on" }));
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    expect(parseParams(draft.params)).toEqual([{ key: "domains", label: "דומיינים של הלקוח", level: "CLIENT", type: "LIST", required: true, default: null, clientField: "domains" }]);
  });

  it("refuses a parameter without a key or a label, or with a key that cannot sit between braces", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    for (const fields of [{ key: "", label: "חתימה" }, { key: "sig", label: "" }, { key: "{{sig}}", label: "חתימה" }, { key: "x".repeat(41), label: "ארוך" }]) {
      expect(await saveParamAction(undefined, form({ agentId: agent.id, level: "AGENT", type: "TEXT", ...fields }))).toEqual({ error: "הטיוטה לא תקינה." });
    }
    expect(await prisma.agentVersion.count({ where: { agentId: agent.id, state: "DRAFT" } })).toBe(0);
  });
});

describe("creating an agent and its version's details", () => {
  it("creates an agent with a known kind, or a scheduled one, and refuses one without a name", async () => {
    const { hadas } = await setup();
    as(hadas);
    const made = await createAgentAction(undefined, form({ name: "Weekly report", purpose: "דוח שבועי", kind: "WHATEVER" }));
    expect(made).toMatchObject({ ok: true, slug: expect.any(String) });
    expect((await prisma.agent.findUniqueOrThrow({ where: { slug: made.slug! } })).kind).toBe("SCHEDULED");
    expect(await createAgentAction(undefined, form({ name: "", purpose: "x", kind: "SKILL" }))).toEqual({ error: "צריך שם לסוכן, עד 80 תווים." });
  });

  it("saves the action level, the change note and the requirements from their text fields", async () => {
    const { hadas, agent } = await setup();
    as(hadas);
    await saveMetaAction(undefined, form({ agentId: agent.id, actionLevel: "ROOT", changeNote: " דרישות ", connectors: "Gmail, Drive\n", skills: "gmail-labels@3, drive-search", repos: "", localMcp: "", externalRunners: "", model: "", notes: "" }));
    const draft = await prisma.agentVersion.findFirstOrThrow({ where: { agentId: agent.id, state: "DRAFT" } });
    expect(draft.actionLevel).toBe("READ");
    expect(draft.changeNote).toBe("דרישות");
    expect(draft.requirements).toMatchObject({ connectors: ["Gmail", "Drive"], skills: [{ slug: "gmail-labels", minVersion: 3 }, "drive-search"], repos: [], model: null, notes: null });
  });
});

describe("client values on the screen", () => {
  it("does not reach a client the person has no access to", async () => {
    const { hadas, agent } = await setup();
    const other = await createTestClient({ name: "Not mine" });
    as(hadas);
    expect((await setClientValueAction(undefined, form({ agentId: agent.id, clientId: other.id, key: "sig", value: "הדס" }))).error).toBeTruthy();
    expect(await prisma.agentClientValue.count({ where: { agentId: agent.id } })).toBe(0);
  });
});
