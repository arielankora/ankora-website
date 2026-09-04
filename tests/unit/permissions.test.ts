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

// Phase 2 - spec 4.1's own example permission list, used verbatim:
// time_entry.create_self, time_entry.edit_self, time_entry.edit_others.
describe("can() - Phase 2 time_entry permissions (spec 4 role table)", () => {
  it("grants SUPER_ADMIN and ANKORA_ADMIN full time_entry permissions including edit_others", () => {
    for (const role of ["SUPER_ADMIN", "ANKORA_ADMIN"] as UserRole[]) {
      expect(can(role, "time_entry.create_self")).toBe(true);
      expect(can(role, "time_entry.edit_self")).toBe(true);
      expect(can(role, "time_entry.edit_others")).toBe(true);
    }
  });

  it("grants ANKORA_EMPLOYEE only create_self/edit_self, never edit_others (spec 4: own timer/reports only)", () => {
    expect(can("ANKORA_EMPLOYEE", "time_entry.create_self")).toBe(true);
    expect(can("ANKORA_EMPLOYEE", "time_entry.edit_self")).toBe(true);
    expect(can("ANKORA_EMPLOYEE", "time_entry.edit_others")).toBe(false);
  });

  it("grants CLIENT_USER no time_entry permissions (spec 4.1: client never gets edit on Ankora's time entries)", () => {
    expect(can("CLIENT_USER", "time_entry.create_self")).toBe(false);
    expect(can("CLIENT_USER", "time_entry.edit_self")).toBe(false);
    expect(can("CLIENT_USER", "time_entry.edit_others")).toBe(false);
  });

  it("keeps ANKORA_ADMIN without audit.view even after Phase 2 (Phase 1's conservative default is unchanged)", () => {
    expect(can("ANKORA_ADMIN", "audit.view")).toBe(false);
  });
});
