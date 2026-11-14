import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, stepsForEditor } from "@/lib/app-domain/processes";

// "קלוד מנסח שלבים" (14.11.2026, processes redesign, stage 3). What is
// worth holding: Claude's draft is saved as a draft version and never
// approved; a process that already has steps is refused, so a person's
// procedure is never written over; and the button is not offered on a
// client marked "בלי AI".

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
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", purpose: "לשלם בזמן", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: [{ code: "S1" }] });
  return { client, hadas, p };
}

describe("save_procedure_draft", () => {
  it("saves Claude's draft as a draft, and refuses once the process has steps", async () => {
    const { client, hadas, p } = await setup();
    const steps = [
      { title: "איסוף חשבוניות", mode: "ASSISTED", offsetBusinessDays: 1, evidence: "קובץ בתיקייה" },
      { title: "העלאה לבנק", offsetBusinessDays: 3 },
    ];
    const first = await call(hadas, "save_procedure_draft", { client: "NUX", process: p.code, steps });
    expect(first.json).toMatchObject({ saved: true, version: 1, steps: 2 });
    expect(first.json.link).toContain(`/app/clients/${client.id}/processes/${p.id}/steps`);
    const version = await prisma.processVersion.findFirstOrThrow({ where: { processId: p.id } });
    expect(version.status).toBe("DRAFT");
    expect(version.steps).toMatchObject([{ title: "איסוף חשבוניות", mode: "ASSISTED", evidence: "קובץ בתיקייה" }, { title: "העלאה לבנק" }]);

    const again = await call(hadas, "save_procedure_draft", { client: "NUX", process: p.code, steps });
    expect(again.text).toContain("כבר יש שלבים");
    expect(await prisma.processVersion.count({ where: { processId: p.id } })).toBe(1);
  });

  it("offers the prompt, and not on a client marked without AI", async () => {
    const { client, hadas, p } = await setup();
    expect((await stepsForEditor(hadas, p.id)).draftPrompt).toContain("save_procedure_draft");
    await prisma.client.update({ where: { id: client.id }, data: { aiExcluded: true } });
    expect((await stepsForEditor(hadas, p.id)).draftPrompt).toBeNull();
  });
});
