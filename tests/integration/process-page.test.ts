import { describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, listProcesses, saveProcessVersion, setProcessKind } from "@/lib/app-domain/processes";
import { saveProcessRhythm, upcomingOfProcess } from "@/lib/app-domain/process-rhythm";
import { runBlockers } from "@/lib/process-readiness";
import { emptyRule } from "@/lib/process-rhythm";

// The process page (13.11.2026, processes redesign, stage 2). What is worth
// holding: a part of the form sent alone changes only that part; a work
// instruction is never "will not run" and opens no runs; the "מתי" card's
// next dates are the process's own.

const S1 = [{ code: "S1" }];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/app-auth/session", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { updateProcessAction } from "@/app/(product)/app/(authenticated)/clients/process-actions";

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const p = await addProcess(hadas, {
    clientId: client.id,
    title: "תשלומי ספקים",
    purpose: "לשלם בזמן",
    ownerId: hadas.id,
    slaText: "יומיים",
    exceptionPlaybook: "ספק חדש: לעצור",
    scope: "ספקים בישראל",
    sources: S1,
  });
  return { client, hadas, ariel, p };
}

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("the process page", () => {
  it("saves one part of the form and leaves the rest as it was", async () => {
    const { client, hadas, ariel, p } = await setup();
    session.user = hadas;
    // "Who", sent alone: nothing else in the process changes.
    const r = await updateProcessAction(undefined, form({ clientId: client.id, id: p.id, _parts: "who", ownerId: ariel.id, backupOwnerId: hadas.id }));
    expect(r.error).toBeUndefined();
    let row = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.ownerId, row.backupOwnerId, row.title, row.purpose, row.slaText, row.exceptionPlaybook, row.scope]).toEqual([ariel.id, hadas.id, "תשלומי ספקים", "לשלם בזמן", "יומיים", "ספק חדש: לעצור", "ספקים בישראל"]);
    // "Work", sent alone, with an emptied field: emptied, and only it.
    await updateProcessAction(undefined, form({ clientId: client.id, id: p.id, _parts: "work", slaText: "", exceptionPlaybook: "ספק חדש: לעצור ולשאול" }));
    row = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.slaText, row.exceptionPlaybook, row.ownerId, row.scope]).toEqual([null, "ספק חדש: לעצור ולשאול", ariel.id, "ספקים בישראל"]);
  });

  it("a work instruction is never 'will not run' and its dates open no runs", async () => {
    const { client, hadas, ariel, p } = await setup();
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "א" }], baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    await setProcessKind(hadas, p.id, "GUIDE");
    const [listed] = await listProcesses(hadas, client.id);
    expect(listed.kind).toBe("GUIDE");
    expect(listed.readiness.ready).toBe(true);
    expect(runBlockers({ kind: "GUIDE", status: "DRAFT", ownerId: null, triggerKinds: [], triggerText: null, nextDate: null })).toEqual([]);
    const audit = await prisma.auditEvent.findMany({ where: { entityId: p.id, action: "process.kind" } });
    expect(audit).toHaveLength(1);
    await setProcessKind(hadas, p.id, "PROCESS");
    expect((await prisma.process.findUniqueOrThrow({ where: { id: p.id } })).kind).toBe("PROCESS");
  });

  it("gives the next dates of the process's own rhythm, the day its run opens and a day a roll moved", async () => {
    const { hadas, ariel, p } = await setup();
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "שליחה", offsetBusinessDays: -2 }, { title: "אישור" }], baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    await saveProcessRhythm(hadas, p.id, [{ kind: "SCHEDULE", schedule: { ...emptyRule("MONTHLY"), monthDays: [10, 25] } }]);
    const rows = await upcomingOfProcess(hadas, p.id, 3, new Date("2026-11-13T10:00:00Z"));
    expect(rows).toEqual([
      { date: "2026-11-25", opens: "2026-11-22", movedFrom: null },
      { date: "2026-12-10", opens: "2026-12-07", movedFrom: null },
      { date: "2026-12-24", opens: "2026-12-21", movedFrom: "2026-12-25" },
    ]);
  });
});
