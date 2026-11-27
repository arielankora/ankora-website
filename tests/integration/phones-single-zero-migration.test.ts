import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "./setup";
import { normalizePhones } from "@/lib/contact-normalize";

// 27.11.2026: four contacts of one client were stored as "0974 4422 ....",
// Qatar with one 0 instead of 00, and no WhatsApp chat could find them. The
// migration rewrites them as normalizePhone would, and nothing else.

async function runMigration() {
  const sql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261128000000_phones_single_zero_international/migration.sql"),
    "utf8",
  );
  const statements = sql
    .split(/;\s*\n/)
    .map((x) => x.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}

describe("phones written with one 0 before 970 to 979", () => {
  it("are rewritten as normalizePhone would, and the rest is left alone", async () => {
    const qatar = await prisma.person.create({ data: { name: "א", phones: ["097444221234", "+972521234567"] } });
    const twice = await prisma.person.create({ data: { name: "ב", phones: ["+97444225678", "0974 4422 5678"] } });
    const israeli = await prisma.person.create({ data: { name: "ג", phones: ["+97297123456", "+972541234567"] } });
    const kept = await prisma.person.create({ data: { name: "ד", phones: ["0812345678901"] } });

    await runMigration();

    const after = async (id: string) => (await prisma.person.findUniqueOrThrow({ where: { id } })).phones;
    expect(await after(qatar.id)).toEqual(["+97444221234", "+972521234567"]);
    expect(await after(twice.id)).toEqual(["+97444225678"]);
    expect(await after(israeli.id)).toEqual(["+97297123456", "+972541234567"]);
    expect(await after(kept.id)).toEqual(["0812345678901"]);
    // The same answer as the app's own rule, for the values it rewrote.
    expect(normalizePhones(["097444221234", "+972521234567"])).toEqual(await after(qatar.id));

    const report = await prisma.appSetting.findUniqueOrThrow({ where: { key: "phones.singleZeroInternational20261128" } });
    expect(report.value).toEqual({ people: 2, numbersRewritten: 2 });

    // A second run changes nothing and keeps the first report.
    await runMigration();
    expect(await after(twice.id)).toEqual(["+97444225678"]);
  });
});
