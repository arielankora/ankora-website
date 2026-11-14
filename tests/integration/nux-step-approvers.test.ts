import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./setup";
import { createTestClient } from "./factories";

// NUX's step approvers (14.11.2026, processes redesign, spec 6.3), as Ariel
// approved them by name. What is worth holding: each lands on its step of
// the approved version, a step with an approver already is left alone, a
// person not of the client is never written, and a second run changes
// nothing.

const P2 = "cmvgiph6d000hjs08l48i79z6";
const P12 = "cmw3x1br8002vjw073cmhkyhu";
const YONATAN = "cmvcgvfes0003jj07uufzkz0m";
const OREN = "cmvdxfi2l0003l708cia0094i";
const HADAS = "cmto4lrj80002jp04u7ezj0by";

async function run() {
  const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261114130000_nux_step_approvers/migration.sql"), "utf8");
  const [fn, rest] = sql.split(/\$\$ LANGUAGE sql;/);
  const calls = rest.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(fn + "$$ LANGUAGE sql;");
    for (const c of [...calls, ...calls]) await tx.$executeRawUnsafe(c);
  });
}

describe("NUX step approvers", () => {
  it("names each approval step's approver, and nothing else", async () => {
    const nux = await createTestClient({ name: "NUX" });
    const other = await createTestClient({ name: "Other" });
    await prisma.user.create({ data: { id: HADAS, email: "hadas-approver@test.ankora.local", name: "Hadas", role: "ANKORA_ADMIN", status: "ACTIVE", passwordHash: "x" } });
    const yonatan = await prisma.person.create({ data: { name: "יונתן" } });
    const oren = await prisma.person.create({ data: { name: "אורן" } });
    await prisma.clientContact.create({ data: { id: YONATAN, clientId: nux.id, personId: yonatan.id } });
    // Oren is not NUX's here: never written.
    await prisma.clientContact.create({ data: { id: OREN, clientId: other.id, personId: oren.id } });
    await prisma.process.create({ data: { id: P2, clientId: nux.id, seq: 2, code: "P2", title: "T2" } });
    await prisma.process.create({ data: { id: P12, clientId: nux.id, seq: 12, code: "P12", title: "T12" } });
    const step = (title: string, approval = false) => ({ title, ...(approval ? { requiresApproval: true } : {}) });
    const v2 = await prisma.processVersion.create({ data: { processId: P2, version: 1, status: "APPROVED", steps: [step("a"), step("b"), step("c"), step("d", true), step("e")] } });
    const v12 = await prisma.processVersion.create({ data: { processId: P12, version: 2, status: "APPROVED", steps: [step("a"), step("b"), step("c"), step("d"), step("e", true), step("f", true)] } });

    await run();

    const s2 = (await prisma.processVersion.findUniqueOrThrow({ where: { id: v2.id } })).steps as Record<string, unknown>[];
    expect(s2[3]).toEqual({ title: "d", requiresApproval: true, approverContactId: YONATAN });
    expect(s2.filter((x) => "approverContactId" in x || "approverUserId" in x)).toHaveLength(1);
    const s12 = (await prisma.processVersion.findUniqueOrThrow({ where: { id: v12.id } })).steps as Record<string, unknown>[];
    expect(s12[4]).toEqual({ title: "e", requiresApproval: true, approverUserId: HADAS });
    expect(s12[5]).toEqual({ title: "f", requiresApproval: true });
  });
});
