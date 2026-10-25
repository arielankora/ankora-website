import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { getClient } from "@/lib/app-domain/clients";
import { CREDENTIAL_PATTERNS } from "../../qa/e2e/routes";

// What a client screen is handed, and therefore what it serialises.
//
// `/app/clients/[clientId]` passes the object `getClient` returns straight
// to `<EditClientForm client={client} />`, a client component. Next
// serialises a client component's props into the RSC payload inside the
// page HTML, so every column on every row in that object is in the source
// of the page.
//
// On 25.10.2026 that object carried the whole User row of each assigned
// employee, bcrypt hash included. TypeScript had nothing to say: the prop
// is declared `Client`, and a variable may carry properties its declared
// type never mentions. Exactly the mechanism of #84.
//
// The browser sweep is what found it, and the browser sweep is the real
// guard, because it checks the page rather than one function. This test
// is the fast one next to it: it fails in a second, in the suite a person
// runs while they are writing the query, instead of eight minutes later
// in a browser. Both are worth having; neither replaces the other.
//
// It matches against CREDENTIAL_PATTERNS rather than against
// "passwordHash", so a credential column added to User, or to any row
// this query starts returning, is caught by the same assertion. The
// patterns are derived from the schema by
// tests/unit/credential-sweep-schema.test.ts.

describe("what the client screen is handed", () => {
  it("names the assigned people without their credentials", async () => {
    const client = await createTestClient({ name: "NUX" });
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });

    const row = await getClient(client.id);
    expect(row, "the client was not found").not.toBeNull();

    // The screen does render the assigned people, so this must not pass
    // by returning nothing: a query that stopped including them would
    // satisfy every pattern below and break the screen.
    expect(row!.employeeAccess).toHaveLength(1);
    expect(row!.employeeAccess[0].user.name).toBe(user.name);
    expect(row!.employeeAccess[0].user.email).toBe(user.email);

    // Serialised the way Next serialises it.
    const payload = JSON.stringify(row);
    for (const { pattern, what } of CREDENTIAL_PATTERNS) {
      expect(payload, `the client screen is handed ${what}`).not.toMatch(pattern);
    }
  });

  it("holds a real hash to match against, so the check above is not vacuous", async () => {
    // If the seed ever stopped giving test users a password, every
    // assertion above would pass against a row that simply had nothing in
    // it. This is the control: the hash exists, and the pattern finds it.
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(stored.passwordHash, "test users have no password, so this file proves nothing").toBeTruthy();
    expect(JSON.stringify(stored)).toMatch(/\$2[aby]\$\d\d\$|passwordHash/);
  });
});
