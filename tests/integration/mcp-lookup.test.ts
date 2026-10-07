import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestClientUser, createTestTimeEntry, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// lib/mcp/lookup.ts against a real database, and its effect through the
// staff MCP tools that read and log time.
//
// tests/unit/mcp/team-tools.test.ts and resolve.test.ts check the tools'
// own decisions and the pure matching rules with everything mocked. What
// a mock cannot show is the property this module exists for: a name the
// model says is matched only against what THIS person may see, so an
// employee naming a client they are not on gets the same answer as for a
// client that does not exist, and a category that belongs to another
// client never appears in a list or an error message.

// Same convention as mcp-portal-and-tasks.test.ts: the "token" is the user.
vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";
import {
  canSeeOthersTime,
  lookupCategory,
  lookupClient,
  lookupTeamMember,
  teamMembers,
  usableCategories,
} from "@/lib/mcp/lookup";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const tools = new Map<string, Handler>();
registerAnkoraTools({
  registerTool: (name: string, _config: unknown, handler: Handler) => tools.set(name, handler),
} as never);

async function call(user: User, name: string, args: unknown = {}) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text, isError: !!result.isError };
  } catch {
    return { json: null, text, isError: !!result.isError };
  }
}

async function person(role: "SUPER_ADMIN" | "ANKORA_ADMIN" | "ANKORA_EMPLOYEE", name: string, email?: string) {
  const { user } = await createTestUser({ role, email });
  return prisma.user.update({ where: { id: user.id }, data: { name } });
}

/// NUX and Acme Labs are Hadas's; "Secret Holdings" exists but is not
/// hers. Categories: one global, one NUX-only, one belonging to Secret
/// Holdings, one inactive global.
async function setup() {
  const ariel = await person("ANKORA_ADMIN", "Ariel");
  const hadas = await person("ANKORA_EMPLOYEE", "Hadas Cohen", `hadas-${Date.now()}@ankora.test`);
  const dana = await person("ANKORA_EMPLOYEE", "Dana Levi");
  const nux = await createTestClient({ name: "NUX" });
  const acme = await createTestClient({ name: "Acme Labs" });
  const secret = await createTestClient({ name: "Secret Holdings" });
  await prisma.userClientAccess.createMany({
    data: [
      { userId: hadas.id, clientId: nux.id },
      { userId: hadas.id, clientId: acme.id },
      { userId: dana.id, clientId: secret.id },
    ],
  });
  const general = await createTestCategory({ name: "General" });
  const nuxOnly = await createTestCategory({ name: "Payroll run", clientId: nux.id });
  const secretOnly = await createTestCategory({ name: "Merger diligence", clientId: secret.id });
  const retired = await prisma.category.create({ data: { name: "Legacy", visibility: "GLOBAL", active: false } });
  return { ariel, hadas, dana, nux, acme, secret, general, nuxOnly, secretOnly, retired };
}

describe("canSeeOthersTime() - who may read other people's hours", () => {
  it("is true for SUPER_ADMIN and ANKORA_ADMIN, false for ANKORA_EMPLOYEE and CLIENT_USER", async () => {
    const { user: sa } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: emp } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const client = await createTestClient();
    const { user: portal } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });
    expect([sa, admin, emp, portal].map(canSeeOthersTime)).toEqual([true, true, false, false]);
  });
});

describe("lookupClient() through the tools - no leaking a client the caller is not on", () => {
  it("answers an employee naming someone else's client exactly as it answers a client that does not exist", async () => {
    const { hadas } = await setup();

    const forbidden = await lookupClient(hadas, "Secret Holdings");
    const missing = await lookupClient(hadas, "Nonexistent Ltd");
    expect(forbidden.ok).toBe(false);
    expect(missing.ok).toBe(false);
    const strip = (r: typeof forbidden, q: string) => (r.ok ? "" : r.message.replace(`"${q}"`, "<q>"));
    // Same sentence, same list of her own clients - nothing that says
    // "exists, but not for you".
    expect(strip(forbidden, "Secret Holdings")).toBe(strip(missing, "Nonexistent Ltd"));
    expect(strip(forbidden, "Secret Holdings")).toContain("Acme Labs, NUX");

    // A partial name that only matches the hidden client resolves to
    // nothing, and the reply never spells out its full name.
    const partial = await call(hadas, "list_categories", { client: "Secret" });
    expect(partial.json).toBeNull();
    expect(partial.text).toContain('No client named "Secret" is available');
    expect(partial.text).not.toContain("Secret Holdings");
  });

  it("does not start a timer or record time against a client the employee is not on", async () => {
    const { hadas } = await setup();

    const start = await call(hadas, "start_timer", { client: "Secret Holdings", category: "General" });
    expect(start.json).toBeNull();
    const entry = await call(hadas, "create_time_entry", {
      client: "Secret Holdings",
      category: "General",
      date: "2026-10-01",
      start: "09:00",
      end: "10:00",
      backdateReason: "test",
    });
    expect(entry.json).toBeNull();
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it("returns an ambiguity, not a guess, when a name matches two of the caller's clients", async () => {
    const { ariel } = await setup();
    await createTestClient({ name: "Acme Retail" });

    const result = await call(ariel, "start_timer", { client: "Acme", category: "General" });
    expect(result.json).toBeNull();
    expect(result.text).toContain('"Acme" matches more than one client');
    expect(result.text).toContain("Acme Labs");
    expect(result.text).toContain("Acme Retail");
    expect(result.text).toContain("Do not pick one yourself");
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("lookupCategory() / usableCategories() - only categories usable for that client", () => {
  it("lists global and this client's own active categories, never another client's or a retired one", async () => {
    const { nux } = await setup();
    const usable = await usableCategories(nux.id);
    expect(usable.map((c) => [c.name, c.scope]).sort()).toEqual([
      ["General", "all clients"],
      ["Payroll run", "this client"],
    ]);
  });

  it("resolves this client's category, refuses another client's without naming it", async () => {
    const { hadas, nux, acme, nuxOnly } = await setup();

    const ok = await lookupCategory(hadas, nux.id, "payroll");
    expect(ok).toEqual({ ok: true, value: { id: nuxOnly.id, name: "Payroll run" } });

    // NUX's own category is not usable on Acme Labs.
    const wrongClient = await lookupCategory(hadas, acme.id, "Payroll run");
    expect(wrongClient.ok).toBe(false);

    // Another client's category, named in full: refused, and the list of
    // alternatives offered is only what NUX can use.
    const other = await lookupCategory(hadas, nux.id, "Merger diligence");
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.message).toContain("General");
      expect(other.message).toContain("Payroll run");
      // The query is echoed back (the user's own words); the offered list is not.
      expect(other.message.split("can use are:")[1]).not.toContain("Merger");
      expect(other.message).not.toContain("Secret Holdings");
    }

    // A retired category cannot be logged against.
    expect((await lookupCategory(hadas, nux.id, "Legacy")).ok).toBe(false);
  });

  it("list_categories through the tool shows the employee only what she may then name", async () => {
    const { hadas } = await setup();
    const res = await call(hadas, "list_categories", { client: "nux" });
    expect(res.json.client).toBe("NUX");
    expect(res.json.categories.map((c: { name: string }) => c.name).sort()).toEqual(["General", "Payroll run"]);
    expect(res.text).not.toContain("Merger diligence");
  });

  it("start_timer refuses a category that belongs to another client and starts nothing", async () => {
    const { hadas } = await setup();
    const res = await call(hadas, "start_timer", { client: "NUX", category: "Merger" });
    expect(res.json).toBeNull();
    expect(res.text).toContain('No category named "Merger"');
    expect(res.text).not.toContain("Merger diligence");
    expect(await prisma.timeEntry.count()).toBe(0);
  });
});

describe("lookupTeamMember() / teamMembers() - the admin-only roster", () => {
  it("refuse an employee outright, even though she is asking about herself", async () => {
    const { hadas } = await setup();
    await expect(lookupTeamMember(hadas, "Hadas Cohen")).rejects.toThrow(ForbiddenError);
    await expect(teamMembers(hadas)).rejects.toThrow(ForbiddenError);
  });

  it("resolves by exact email first, by name otherwise, and reports ambiguity instead of picking", async () => {
    const { ariel, hadas } = await setup();
    const other = await person("ANKORA_EMPLOYEE", "Hadas Mizrahi");

    // "Hadas" is two people.
    const ambiguous = await lookupTeamMember(ariel, "Hadas");
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.message).toContain("matches more than one team member");
      expect(ambiguous.message).toContain("Hadas Cohen");
      expect(ambiguous.message).toContain("Hadas Mizrahi");
    }

    // The email settles it, whatever its case.
    const byEmail = await lookupTeamMember(ariel, hadas.email.toUpperCase());
    expect(byEmail).toEqual({ ok: true, value: { id: hadas.id, name: "Hadas Cohen", email: hadas.email } });
    expect(await lookupTeamMember(ariel, "mizrahi")).toMatchObject({ ok: true, value: { id: other.id } });
  });

  it("leaves suspended and deleted people out of the roster and out of name matching", async () => {
    const { ariel, hadas, dana } = await setup();
    await prisma.user.update({ where: { id: dana.id }, data: { status: "SUSPENDED" } });
    const gone = await person("ANKORA_EMPLOYEE", "Gone Person");
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const roster = await teamMembers(ariel);
    const names = roster.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["Ariel", "Hadas Cohen"]));
    expect(names).not.toContain("Dana Levi");
    expect(names).not.toContain("Gone Person");
    expect(roster.find((m) => m.id === hadas.id)).toEqual({ id: hadas.id, name: "Hadas Cohen", email: hadas.email, role: "ANKORA_EMPLOYEE" });

    expect((await lookupTeamMember(ariel, "Dana Levi")).ok).toBe(false);
    expect((await lookupTeamMember(ariel, "Gone Person")).ok).toBe(false);
  });

  // QUESTION (not marked as a bug): teamMembers() filters on status and
  // deletedAt but not on role, so CLIENT_USER portal accounts (a client's
  // own contacts, with their emails) appear in list_team_members, whose
  // description promises "active Ankora staff". Only admins can call it
  // and they can see those users elsewhere, but the roster is handed to a
  // third-party model's context. Asserted as it is today.
  it("currently includes client portal users in the roster (see QUESTION above)", async () => {
    const { ariel, nux } = await setup();
    const { user: oren } = await createTestClientUser({ clientId: nux.id, role: "ADMIN" });
    const roster = await teamMembers(ariel);
    expect(roster.some((m) => m.id === oren.id && m.role === "CLIENT_USER")).toBe(true);
  });
});

describe("list_team_members / list_team_time_entries - managers only", () => {
  async function seedTime() {
    const s = await setup();
    const t = (userId: string, clientId: string, hoursAgo: number) =>
      createTestTimeEntry({
        userId,
        clientId,
        categoryId: s.general.id,
        startAt: new Date(Date.now() - hoursAgo * 3600_000),
        endAt: new Date(Date.now() - (hoursAgo - 1) * 3600_000),
      });
    const h1 = await t(s.hadas.id, s.nux.id, 5);
    const h2 = await t(s.hadas.id, s.acme.id, 10);
    const d1 = await t(s.dana.id, s.secret.id, 3);
    return { ...s, h1, h2, d1 };
  }

  it("refuse an ANKORA_EMPLOYEE with a permission message and hand back no data", async () => {
    const { hadas } = await seedTime();

    const members = await call(hadas, "list_team_members");
    expect(members.isError).toBe(true);
    expect(members.text).toContain("Permission denied");
    expect(members.text).not.toContain("Dana");

    // Asking for a colleague's hours, and for the whole team's.
    for (const args of [{ person: "Dana Levi" }, {}]) {
      const res = await call(hadas, "list_team_time_entries", args);
      expect(res.isError).toBe(true);
      expect(res.text).toContain("Permission denied");
      expect(res.text).not.toContain("Secret Holdings");
    }
  });

  it("points a client portal user at the portal connector instead", async () => {
    const { nux } = await seedTime();
    const { user: oren } = await createTestClientUser({ clientId: nux.id, role: "ADMIN" });
    const res = await call(oren, "list_team_time_entries", {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain("/api/mcp/portal");
    expect(res.text).not.toContain("NUX");
  });

  it("let a manager read the roster and one person's entries by name, and nobody else's", async () => {
    const { ariel, h1, h2 } = await seedTime();

    const members = await call(ariel, "list_team_members");
    expect(members.json.members.map((m: { name: string }) => m.name)).toEqual(
      expect.arrayContaining(["Ariel", "Hadas Cohen", "Dana Levi"])
    );

    const res = await call(ariel, "list_team_time_entries", { person: "hadas" });
    expect(res.json.person).toBe("Hadas Cohen");
    expect(res.json.entries.map((e: { id: string }) => e.id)).toEqual([h1.id, h2.id]);
    expect(res.json.entries.every((e: { employee: string }) => e.employee === "Hadas Cohen")).toBe(true);

    const nuxOnly = await call(ariel, "list_team_time_entries", { person: "hadas", client: "NUX" });
    expect(nuxOnly.json.entries.map((e: { id: string }) => e.id)).toEqual([h1.id]);
  });

  it("asks which person when a name is ambiguous, and returns no entries", async () => {
    const { ariel } = await seedTime();
    await person("ANKORA_EMPLOYEE", "Hadas Mizrahi");
    const res = await call(ariel, "list_team_time_entries", { person: "Hadas" });
    expect(res.json).toBeNull();
    expect(res.text).toContain('"Hadas" matches more than one team member');
  });

  it("list_my_time_entries stays self-scoped for the employee: her entries only, no employee names", async () => {
    const { hadas, h1, h2 } = await seedTime();
    const res = await call(hadas, "list_my_time_entries", {});
    expect(res.json.entries.map((e: { id: string }) => e.id)).toEqual([h1.id, h2.id]);
    expect(res.text).not.toContain("Secret Holdings");
    expect(res.text).not.toContain('"employee"');
  });
});
