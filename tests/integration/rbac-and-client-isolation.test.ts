import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestUser, createTestClient } from "./factories";
import { inviteUser, setUserClientAccess } from "@/lib/app-domain/users";
import { createClient, updateClient } from "@/lib/app-domain/clients";
import { createCategory } from "@/lib/app-domain/categories";
import { ForbiddenError } from "@/lib/app-auth/permissions";

describe("RBAC enforcement - spec 4.1 'every server endpoint checks authorization'", () => {
  it("blocks an ANKORA_EMPLOYEE (no permissions) from inviting a user", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await expect(
      inviteUser(employee, { name: "Someone", email: "someone@test.ankora.local", role: "ANKORA_EMPLOYEE" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks an ANKORA_ADMIN (client/category management only) from inviting a user", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });

    await expect(
      inviteUser(admin, { name: "Someone", email: "someone2@test.ankora.local", role: "ANKORA_EMPLOYEE" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows a SUPER_ADMIN to invite a user", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });

    const { user: invited } = await inviteUser(superAdmin, {
      name: "Invited Person",
      email: "invited@test.ankora.local",
      role: "ANKORA_EMPLOYEE",
    });

    expect(invited.status).toBe("INVITED");
  });

  it("blocks an ANKORA_EMPLOYEE from creating a client", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(createClient(employee, { name: "New Client" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an ANKORA_ADMIN to create a client and category", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });

    const client = await createClient(admin, { name: "Admin-created client" });
    expect(client.status).toBe("ACTIVE");

    const category = await createCategory(admin, { name: "Onboarding", visibility: "CLIENT", clientId: client.id });
    expect(category.clientId).toBe(client.id);
  });

  it("archiving a client is a soft delete, not a hard delete", async () => {
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const client = await createTestClient();

    await updateClient(admin, client.id, { status: "ARCHIVED" });

    const row = await prisma.client.findUnique({ where: { id: client.id } });
    expect(row).not.toBeNull(); // still exists in the DB
  });
});

describe("Client isolation - spec 4.1 'an employee cannot be assigned to a client they have no access to'", () => {
  it("only grants access to the clients explicitly assigned via UserClientAccess", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const clientA = await createTestClient({ name: "Client A" });
    const clientB = await createTestClient({ name: "Client B" });

    await setUserClientAccess(superAdmin, employee.id, [clientA.id]);

    const access = await prisma.userClientAccess.findMany({ where: { userId: employee.id } });
    expect(access.map((a) => a.clientId)).toEqual([clientA.id]);
    expect(access.map((a) => a.clientId)).not.toContain(clientB.id);
  });

  it("replaces (does not accumulate) access when set again with a different client list", async () => {
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const clientA = await createTestClient({ name: "Client A" });
    const clientB = await createTestClient({ name: "Client B" });

    await setUserClientAccess(superAdmin, employee.id, [clientA.id]);
    await setUserClientAccess(superAdmin, employee.id, [clientB.id]);

    const access = await prisma.userClientAccess.findMany({ where: { userId: employee.id } });
    expect(access.map((a) => a.clientId)).toEqual([clientB.id]);
  });
});
