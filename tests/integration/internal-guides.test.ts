import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./setup";
import { createTestClient } from "./factories";

// Spec 6.1 (Ariel, 14.11.2026): nine of Ankora's own processes become work
// instructions, P22 is retired, and nothing else changes; a second run
// changes nothing either.

const INTERNAL = "cmucgdw0r0000id04857t82r7";

describe("the internal file's work instructions", () => {
  it("turns the nine into work instructions and retires P22, only in Ankora's own file", async () => {
    const internal = await createTestClient({ name: "Ankora פנימי" });
    await prisma.client.update({ where: { id: internal.id }, data: { id: INTERNAL } });
    const other = await createTestClient({ name: "NUX" });
    const codes = ["P3", "P5", "P6", "P7", "P14", "P16", "P17", "P18", "P21", "P22", "P24"];
    for (const [i, code] of codes.entries()) {
      await prisma.process.create({ data: { clientId: INTERNAL, seq: Number(code.slice(1)), code, title: `T${i}`, status: code === "P22" ? "PAUSED" : "ACTIVE" } });
    }
    await prisma.process.create({ data: { clientId: other.id, seq: 3, code: "P3", title: "Other" } });

    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261114150000_internal_guides/migration.sql"), "utf8");
    const statements = sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    for (const s of [...statements, ...statements]) await prisma.$executeRawUnsafe(s);

    const rows = await prisma.process.findMany({ where: { clientId: INTERNAL }, select: { code: true, kind: true, status: true } });
    const by = new Map(rows.map((r) => [r.code, r]));
    for (const code of ["P3", "P5", "P7", "P14", "P16", "P17", "P18", "P21", "P24"]) expect(by.get(code)?.kind).toBe("GUIDE");
    expect(by.get("P6")).toMatchObject({ kind: "PROCESS", status: "ACTIVE" });
    expect(by.get("P22")).toMatchObject({ kind: "PROCESS", status: "RETIRED" });
    expect((await prisma.process.findFirstOrThrow({ where: { clientId: other.id } })).kind).toBe("PROCESS");
  });
});
