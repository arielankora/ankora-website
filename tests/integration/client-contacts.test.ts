import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  addClientContact,
  addClientOrganization,
  listClientPeople,
  listOrganizationNames,
  removeClientContact,
  updateClientContact,
} from "@/lib/app-domain/client-contacts";
import { addClientSource } from "@/lib/app-domain/client-sources";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 3.5, decision 8).
//
// What is worth holding here: a person is stored once however many
// clients they serve, their details are shared, and what each client
// knows about them stays with that client.

async function employeeOn(...clientIds: string[]) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  for (const clientId of clientIds) {
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
    // Every item needs a source (spec 3.2). S1 in each client's register.
    if ((await prisma.clientSource.count({ where: { clientId } })) === 0) {
      await addClientSource(user, { clientId, kind: "TRANSCRIPT", title: "פגישת היכרות" });
    }
  }
  return user;
}

const S1 = [{ code: "S1" }];

describe("client contacts: one person, many clients", () => {
  it("the same email in two clients' files is one person, with a context per client", async () => {
    const nux = await createTestClient({ name: "NUX" });
    const other = await createTestClient({ name: "Other" });
    const user = await employeeOn(nux.id, other.id);

    await addClientContact(user, {
      clientId: nux.id,
      sources: S1,
      name: "שני הלוי",
      role: "VP Finance",
      relationship: "PROVIDER",
      emails: ["Shani.Halevi@Nextage.co.il"],
      organizationName: "Nextage",
      context: "פונים אליה בכל ספק של Inc.",
    });
    await addClientContact(user, {
      clientId: other.id,
      sources: S1,
      name: "שני",
      relationship: "PROVIDER",
      emails: ["shani.halevi@nextage.co.il"],
      phones: ["054-123-4567"],
      context: "אחראית על הדוחות הרבעוניים.",
    });

    expect(await prisma.person.count()).toBe(1);
    const person = await prisma.person.findFirstOrThrow();
    expect(person.emails).toEqual(["shani.halevi@nextage.co.il"]);
    expect(person.phones).toEqual(["+972541234567"]);
    expect(person.name).toBe("שני הלוי"); // the first spelling stays

    const nuxFile = await listClientPeople(user, nux.id);
    expect(nuxFile.contacts).toHaveLength(1);
    expect(nuxFile.contacts[0].context).toBe("פונים אליה בכל ספק של Inc.");
    expect(nuxFile.contacts[0].person.organization?.name).toBe("Nextage");
  });

  it("an employee of one client sees nothing of another client's file", async () => {
    const nux = await createTestClient({ name: "NUX" });
    const other = await createTestClient({ name: "Other" });
    const onNux = await employeeOn(nux.id);
    const onOther = await employeeOn(other.id);

    await addClientContact(onOther, { clientId: other.id, sources: S1, name: "עו״ד פרטי", relationship: "ADVISOR", organizationName: "משרד עורכי דין פרטי" });

    await expect(listClientPeople(onNux, other.id)).rejects.toBeInstanceOf(ForbiddenError);
    // The organization picker does not list a firm that only another
    // client's file knows about.
    expect(await listOrganizationNames(onNux, nux.id)).not.toContain("משרד עורכי דין פרטי");
    expect(await listOrganizationNames(onOther, other.id)).toContain("משרד עורכי דין פרטי");
  });

  it("refuses a contact with neither name nor role, and a non-confirmed one without what would close it", async () => {
    const client = await createTestClient();
    const user = await employeeOn(client.id);
    await expect(addClientContact(user, { clientId: client.id, sources: S1, emails: ["x@y.com"] })).rejects.toThrow("שם או תפקיד");
    await expect(
      addClientContact(user, { clientId: client.id, sources: S1, name: "דורון", knowledgeStatus: "UNCERTAIN" })
    ).rejects.toThrow("מה יסגור");
    const ok = await addClientContact(user, {
      clientId: client.id,
      sources: S1,
      role: "מנקה",
      relationship: "SUPPLIER",
      knowledgeStatus: "MISSING",
      toResolve: "לבקש את השם מהמשרד",
    });
    expect(ok.knowledgeStatus).toBe("MISSING");
  });

  it("keeps one primary contact per client", async () => {
    const client = await createTestClient();
    const user = await employeeOn(client.id);
    const a = await addClientContact(user, { clientId: client.id, sources: S1, name: "גיא", isPrimary: true });
    const b = await addClientContact(user, { clientId: client.id, sources: S1, name: "אורן", isPrimary: true });
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: a.id } })).isPrimary).toBe(false);
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: b.id } })).isPrimary).toBe(true);
  });

  it("an edit that would give a person another person's email is refused", async () => {
    const client = await createTestClient();
    const user = await employeeOn(client.id);
    await addClientContact(user, { clientId: client.id, sources: S1, name: "אורן", emails: ["oren@nux.ai"] });
    const guy = await addClientContact(user, { clientId: client.id, sources: S1, name: "גיא", emails: ["guy@nux.ai"] });
    await expect(updateClientContact(user, guy.id, { emails: ["oren@nux.ai"] })).rejects.toThrow("כבר שייכת");
  });

  it("restricted items are hidden from everyone not named; removal is soft", async () => {
    const client = await createTestClient();
    const named = await employeeOn(client.id);
    const notNamed = await employeeOn(client.id);
    const contact = await addClientContact(named, {
      clientId: client.id,
      sources: S1,
      name: "גיא",
      audience: "RESTRICTED",
      audienceUserIds: [named.id],
      doNotDisclose: "עובדי הלקוח, עד הודעה של אורן",
    });
    expect((await listClientPeople(named, client.id)).contacts).toHaveLength(1);
    expect((await listClientPeople(notNamed, client.id)).contacts).toHaveLength(0);

    await removeClientContact(named, contact.id);
    expect((await listClientPeople(named, client.id)).contacts).toHaveLength(0);
    expect(await prisma.clientContact.count()).toBe(1);
    expect(await prisma.person.count()).toBe(1);
  });
});

describe("client organizations: one firm, linked per client", () => {
  it("matches an existing organization by domain, not by spelling", async () => {
    const a = await createTestClient({ name: "A" });
    const b = await createTestClient({ name: "B" });
    const user = await employeeOn(a.id, b.id);
    await addClientOrganization(user, { clientId: a.id, sources: S1, name: "Nextage", domains: ["nextage.co.il"], role: "הנהלת חשבונות", monthlyCostMinor: 2_200_000 });
    await addClientOrganization(user, { clientId: b.id, sources: S1, name: "נקסטאייג׳", domains: ["https://www.nextage.co.il"] });
    expect(await prisma.organization.count()).toBe(1);
    expect((await listClientPeople(user, a.id)).organizations[0].monthlyCostMinor).toBe(2_200_000);
    await expect(addClientOrganization(user, { clientId: a.id, sources: S1, name: "Nextage" })).rejects.toThrow("כבר בתיק");
  });
});

describe("lookup_contact", () => {
  it("finds the person by address or number, only in clients this person can reach, never what the audience hides", async () => {
    const { lookupContact } = await import("@/lib/app-domain/client-contacts");
    const nux = await createTestClient({ name: "NUX" });
    const other = await createTestClient({ name: "Other" });
    const both = await employeeOn(nux.id, other.id);
    const onlyNux = await employeeOn(nux.id);

    await addClientContact(both, { clientId: nux.id, name: "שני הלוי", role: "VP Finance", relationship: "PROVIDER", emails: ["shani@nextage.co.il"], phones: ["054-1234567"], organizationName: "Nextage", sources: S1 });
    await addClientContact(both, { clientId: other.id, name: "שני", role: "רו״ח", emails: ["shani@nextage.co.il"], sources: S1 });

    expect((await lookupContact(both, "SHANI@nextage.co.il")).map((m) => m.client).sort()).toEqual(["NUX", "Other"]);
    const fromNux = await lookupContact(onlyNux, "+972 54-123-4567");
    expect(fromNux).toEqual([expect.objectContaining({ name: "שני הלוי", client: "NUX", role: "VP Finance", organization: "Nextage" })]);
    expect(JSON.stringify(fromNux)).not.toContain("@");
    expect(await lookupContact(onlyNux, "nobody@nowhere.com")).toEqual([]);
    await expect(lookupContact(onlyNux, "not an address")).rejects.toThrow("מייל או מספר");
  });

  it("does not tell a manager about a restricted link they are not named on", async () => {
    const { lookupContact } = await import("@/lib/app-domain/client-contacts");
    const nux = await createTestClient({ name: "NUX" });
    const named = await employeeOn(nux.id);
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    await addClientContact(named, { clientId: nux.id, name: "דורון", role: "Contractor", emails: ["doron@example.com"], audience: "RESTRICTED", audienceUserIds: [named.id], sources: S1 });
    expect(await lookupContact(manager, "doron@example.com")).toEqual([]);
    expect(await lookupContact(named, "doron@example.com")).toEqual([expect.objectContaining({ name: "דורון", client: "NUX" })]);
  });
});

