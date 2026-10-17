import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { addClientSource, removeClientSource } from "@/lib/app-domain/client-sources";
import { addRequestType, listRequestTypes, updateRequestType } from "@/lib/app-domain/request-types";
import { NarrativeConflictError, listNarratives, saveNarrative } from "@/lib/app-domain/client-narratives";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { addProcess } from "@/lib/app-domain/processes";
import { updateClient } from "@/lib/app-domain/clients";

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 3.3 and 3.7).
//
// What is worth holding here: a request type routes only to people in
// this client's file, the free text keeps every version and refuses a
// save made against an older one, and a code cited in it must exist.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה" });
  return { client, user };
}

const S1 = [{ code: "S1" }];

describe("request types", () => {
  it("routes to people in this client's file only, and names them", async () => {
    const { client, user } = await setup();
    const other = await createTestClient({ name: "Other" });
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId: other.id } });
    await addClientSource(user, { clientId: other.id, kind: "PERSON", title: "x" });
    const stranger = await addClientContact(user, { clientId: other.id, name: "זר", sources: S1 });
    const shani = await addClientContact(user, { clientId: client.id, name: "שני", sources: S1 });

    await expect(
      addRequestType(user, { clientId: client.id, title: "חשבונית Inc", handling: "לשני", routeToContactIds: [stranger.id], sources: S1 })
    ).rejects.toThrow("לא נמצא בתיק");
    await expect(addRequestType(user, { clientId: client.id, title: "חשבונית Inc", handling: " ", sources: S1 })).rejects.toThrow("איך עונים");

    const rt = await addRequestType(user, {
      clientId: client.id,
      title: "חשבונית Inc",
      fromWho: "ספק",
      arrivesVia: "billing-us",
      handling: "לשני ולג'נן, לא לאיילה",
      routeToContactIds: [shani.id, shani.id],
      sources: S1,
    });
    expect(rt.routeToContactIds).toEqual([shani.id]);
    expect((await listRequestTypes(user, client.id))[0].routeToNames).toEqual(["שני"]);

    const edited = await updateRequestType(user, rt.id, { routeToContactIds: [] });
    expect(edited.routeToContactIds).toEqual([]);
    expect(toMarkdown(await buildClientFile(user, client.id, { audience: "ai" }))).toContain("## 7.5. סוגי פניות ודרכי מענה");
  });
});

describe("what a request sets off, and who the client is", () => {
  it("a request type names a process of this client only, and the file says so", async () => {
    const { client, user } = await setup();
    const trip = await addProcess(user, { clientId: client.id, title: "נסיעת עובד", triggerKinds: ["EVENT"], sources: S1 });
    const other = await createTestClient({ name: "אחר" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const foreign = await addProcess(admin, { clientId: other.id, title: "תהליך זר", triggerKinds: ["EVENT"], knowledgeStatus: "MISSING", toResolve: "לברר" });

    const rt = await addRequestType(user, { clientId: client.id, title: "עובד טס", handling: "פותחים את תהליך הנסיעה", processId: trip.id, sources: S1 });
    expect(rt.processId).toBe(trip.id);
    await expect(updateRequestType(user, rt.id, { processId: foreign.id })).rejects.toThrow("לא נמצא אצל הלקוח");
    expect(toMarkdown(await buildClientFile(user, client.id, { audience: "staff" }))).toContain(`מפעיל: ${trip.code} נסיעת עובד`);
  });

  it("a private client says so in section 1, with what they do", async () => {
    const { client, user } = await setup();
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    await updateClient(admin, client.id, { kind: "PRIVATE", industry: "משפחה, שני ילדים" });
    const doc = await buildClientFile(user, client.id, { audience: "staff" });
    expect(doc.sections[0].items[0].details).toEqual(["לקוח פרטי", "משפחה, שני ילדים"]);
  });
});

describe("the file's free text", () => {
  it("keeps every version, refuses a save against an old one, and checks cited codes", async () => {
    const { client, user } = await setup();
    const v1 = await saveNarrative(user, { clientId: client.id, kind: "OVERVIEW", body: "חברה, סטארטאפ AI [S1 08:13]", baseVersion: 0 });
    expect(v1?.version).toBe(1);
    await expect(saveNarrative(user, { clientId: client.id, kind: "OVERVIEW", body: "שונה", baseVersion: 0 })).rejects.toBeInstanceOf(NarrativeConflictError);
    await expect(saveNarrative(user, { clientId: client.id, kind: "OVERVIEW", body: "לפי [S7]", baseVersion: 1 })).rejects.toThrow("S7");
    // Saving the same words is no new version.
    expect(await saveNarrative(user, { clientId: client.id, kind: "OVERVIEW", body: "חברה, סטארטאפ AI [S1 08:13]", baseVersion: 1 })).toBeNull();
    await saveNarrative(user, { clientId: client.id, kind: "OVERVIEW", body: "חברה, סטארטאפ AI עם שתי ישויות [S1 08:13]", baseVersion: 1 });

    const overview = (await listNarratives(user, client.id)).find((n) => n.kind === "OVERVIEW")!;
    expect(overview.current?.version).toBe(2);
    expect(overview.history.map((h) => h.version)).toEqual([1]);

    // A source the current text cites cannot be removed.
    const s1 = await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, code: "S1" } });
    await expect(removeClientSource(user, s1.id)).rejects.toThrow("1 פריטים");
    expect(toMarkdown(await buildClientFile(user, client.id, { audience: "staff" }))).toContain("סקירה: חברה, סטארטאפ AI עם שתי ישויות");
  });

  it("is closed to anyone not assigned to the client", async () => {
    const { client } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(listNarratives(stranger, client.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveNarrative(stranger, { clientId: client.id, kind: "OVERVIEW", body: "x", baseVersion: 0 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
