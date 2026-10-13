import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { effectiveStatus, parseFieldStatus } from "@/lib/knowledge";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import {
  addClientEntity,
  listClientEntities,
  removeClientEntity,
  updateClientEntity,
} from "@/lib/app-domain/client-entities";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 3.3).
//
// What is worth holding here: a missing detail is marked, not left blank,
// and makes the entity read as missing; people and systems belong to an
// entity of the same client only; an entity in use cannot be removed.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישת חפיפה" });
  return { client, user };
}

const S1 = [{ code: "S1" }];

describe("client entities", () => {
  it("a missing registration number makes a confirmed entity read as missing", async () => {
    const { client, user } = await setup();
    const inc = await addClientEntity(user, { clientId: client.id, name: "Inc", legalName: "NUX Inc", country: "us", currency: "usd", sources: S1 });
    expect(inc.country).toBe("US");
    expect(inc.currency).toBe("USD");

    await expect(
      addClientEntity(user, { clientId: client.id, name: "LTD", missingFields: ["registrationNumber"], sources: S1 })
    ).rejects.toThrow("מה יסגור");
    const ltd = await addClientEntity(user, {
      clientId: client.id,
      name: "LTD",
      legalName: "NUX.AI Ltd",
      parentId: inc.id,
      // Typed and marked missing at once: the mark wins.
      registrationNumber: "5155",
      missingFields: ["registrationNumber"],
      missingToResolve: "לבקש מהמנכ״ל את תעודת ההתאגדות",
      sources: S1,
    });
    expect(ltd.registrationNumber).toBeNull();
    expect(ltd.knowledgeStatus).toBe("CONFIRMED");
    expect(effectiveStatus(ltd.knowledgeStatus, parseFieldStatus(ltd.fieldStatus))).toBe("MISSING");

    const filled = await updateClientEntity(user, ltd.id, { registrationNumber: "515512345", missingFields: [] });
    expect(filled.registrationNumber).toBe("515512345");
    expect(effectiveStatus(filled.knowledgeStatus, parseFieldStatus(filled.fieldStatus))).toBe("CONFIRMED");
    expect((await listClientEntities(user, client.id)).map((e) => e.name)).toEqual(["Inc", "LTD"]);
  });

  it("refuses bad codes and a parent that would make a cycle", async () => {
    const { client, user } = await setup();
    await expect(addClientEntity(user, { clientId: client.id, name: "X", country: "Israel", sources: S1 })).rejects.toThrow("קוד המדינה");
    const a = await addClientEntity(user, { clientId: client.id, name: "A", sources: S1 });
    const b = await addClientEntity(user, { clientId: client.id, name: "B", parentId: a.id, sources: S1 });
    await expect(updateClientEntity(user, a.id, { parentId: b.id })).rejects.toThrow("מעגל");
    await expect(updateClientEntity(user, a.id, { parentId: a.id })).rejects.toThrow("של עצמה");
  });

  it("people and systems belong to an entity of the same client only, and an entity in use stays", async () => {
    const { client, user } = await setup();
    const other = await createTestClient({ name: "Other" });
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId: other.id } });
    await addClientSource(user, { clientId: other.id, kind: "PERSON", title: "x" });
    const theirs = await addClientEntity(user, { clientId: other.id, name: "Other Inc", sources: S1 });
    const inc = await addClientEntity(user, { clientId: client.id, name: "Inc", sources: S1 });

    await expect(addClientContact(user, { clientId: client.id, name: "שני", entityId: theirs.id, sources: S1 })).rejects.toThrow("הישות");
    await expect(addSystemAccess(user, { clientId: client.id, systemName: "Mercury", entityId: theirs.id, sources: S1 })).rejects.toThrow("הישות");

    const shani = await addClientContact(user, { clientId: client.id, name: "שני", entityId: inc.id, sources: S1 });
    expect(shani.entityId).toBe(inc.id);
    await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", entityId: inc.id, sources: S1 });
    await expect(removeClientEntity(user, inc.id)).rejects.toThrow("2 פריטים");
  });

  it("is closed to anyone not assigned to the client", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(listClientEntities(stranger, client.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
