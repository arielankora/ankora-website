import { describe, expect, it } from "vitest";
import { can, assertCan, canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import type { UserRole } from "@prisma/client";

const ALL_ROLES: UserRole[] = ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE", "CLIENT_USER"];

describe("can()", () => {
  it("grants SUPER_ADMIN every Phase 1 permission", () => {
    expect(can("SUPER_ADMIN", "user.manage")).toBe(true);
    expect(can("SUPER_ADMIN", "client.manage")).toBe(true);
    expect(can("SUPER_ADMIN", "category.manage")).toBe(true);
    expect(can("SUPER_ADMIN", "audit.view")).toBe(true);
  });

  it("grants ANKORA_ADMIN client/category management but not user management or audit", () => {
    expect(can("ANKORA_ADMIN", "client.manage")).toBe(true);
    expect(can("ANKORA_ADMIN", "category.manage")).toBe(true);
    expect(can("ANKORA_ADMIN", "user.manage")).toBe(false);
    expect(can("ANKORA_ADMIN", "audit.view")).toBe(false);
  });

  it("grants ANKORA_EMPLOYEE and CLIENT_USER no Phase 1 admin permissions", () => {
    for (const role of ["ANKORA_EMPLOYEE", "CLIENT_USER"] as UserRole[]) {
      expect(can(role, "user.manage")).toBe(false);
      expect(can(role, "client.manage")).toBe(false);
      expect(can(role, "category.manage")).toBe(false);
      expect(can(role, "audit.view")).toBe(false);
    }
  });
});

describe("assertCan()", () => {
  it("does not throw when the role holds the permission", () => {
    expect(() => assertCan("SUPER_ADMIN", "user.manage")).not.toThrow();
  });

  it("throws ForbiddenError when the role lacks the permission", () => {
    expect(() => assertCan("ANKORA_EMPLOYEE", "user.manage")).toThrow(ForbiddenError);
  });
});

describe("canManageClients()", () => {
  it("matches client.manage exactly for every role", () => {
    for (const role of ALL_ROLES) {
      expect(canManageClients(role)).toBe(can(role, "client.manage"));
    }
  });
});
