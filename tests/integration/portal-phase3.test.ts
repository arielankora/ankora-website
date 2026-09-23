import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  getPortalFile,
  resolvePortalDocument,
  updatePortalDigest,
  updatePortalPreferences,
} from "@/lib/app-domain/client-file";
import { updateTask } from "@/lib/app-domain/tasks";
import {
  approvePortalSummary,
  buildSummaryDraft,
  generatePortalSummary,
  getApprovedSummaries,
  monthRange,
} from "@/lib/app-domain/portal-summary";

// Portal phase 3. Almost everything worth testing here is a NEGATIVE:
// what the client's file must not show, and who must not be able to
// change it. The four lists themselves are one query each; the rules
// around them are where a mistake becomes a client reading something
// about a supplier we would never have shown them.

async function seedTask(
  clientId: string,
  overrides: {
    title?: string;
    clientVisible?: boolean;
    status?: "OPEN" | "IN_PROGRESS" | "DONE";
    supplierName?: string | null;
    supplierExperience?: "GOOD" | "OK" | "AVOID" | null;
    supplierRecordedAt?: Date | null;
  } = {}
) {
  return prisma.task.create({
    data: {
      clientId,
      title: overrides.title ?? "משימה",
      clientVisible: overrides.clientVisible ?? true,
      status: overrides.status ?? "DONE",
      supplierName: overrides.supplierName ?? null,
      supplierExperience: overrides.supplierExperience ?? null,
      supplierRecordedAt: overrides.supplierRecordedAt ?? null,
    },
  });
}

async function seedDocument(
  clientId: string,
  overrides: { title?: string; clientVisible?: boolean; deleted?: boolean } = {}
) {
  return prisma.clientDocument.create({
    data: {
      clientId,
      title: overrides.title ?? "פוליסה",
      driveFileId: `drive-${Math.random().toString(36).slice(2)}`,
      mimeType: "application/pdf",
      clientVisible: overrides.clientVisible ?? true,
      deletedAt: overrides.deleted ? new Date() : null,
    },
  });
}

async function seedDate(
  clientId: string,
  responsibleUserId: string,
  overrides: { title?: string; clientVisible?: boolean; sensitivity?: "NORMAL" | "SENSITIVE" } = {}
) {
  return prisma.importantDate.create({
    data: {
      clientId,
      title: overrides.title ?? "חידוש ביטוח",
      type: "renewal",
      category: "DOCUMENTS_AUTHORITIES",
      month: 3,
      day: 14,
      responsibleUserId,
      additionalUserIds: [],
      extraEmailRecipients: [],
      clientVisible: overrides.clientVisible ?? true,
      sensitivity: overrides.sensitivity ?? "NORMAL",
      nextOccurrenceAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
}

describe("getPortalFile()", () => {
  it("derives suppliers only from promises the client was already shown", async () => {
    const client = await createTestClient({ name: "Client Suppliers" });
    const { user } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, {
      title: "תיקון דוד",
      clientVisible: true,
      supplierName: "חשמלאי כהן",
      supplierExperience: "GOOD",
      supplierRecordedAt: new Date(),
    });
    // Same supplier line, on a task nobody opted in. Showing it would
    // announce work the client was never told about.
    await seedTask(client.id, {
      title: "בירור פנימי",
      clientVisible: false,
      supplierName: "ספק סמוי",
      supplierExperience: "OK",
      supplierRecordedAt: new Date(),
    });
    // And a visible task with no supplier recorded is simply not a
    // supplier row.
    await seedTask(client.id, { title: "בלי ספק", clientVisible: true });

    const file = await getPortalFile(user);

    expect(file.suppliers.map((s) => s.name)).toEqual(["חשמלאי כהן"]);
  });

  it("never shows a sensitive date, even when it is marked visible", async () => {
    const client = await createTestClient({ name: "Client Dates" });
    const { user } = await createTestClientUser({ clientId: client.id });
    const { user: staff } = await createTestUser({ role: "ANKORA_ADMIN" });

    await seedDate(client.id, staff.id, { title: "חידוש רישיון", clientVisible: true });
    await seedDate(client.id, staff.id, { title: "מועד רפואי", clientVisible: true, sensitivity: "SENSITIVE" });
    await seedDate(client.id, staff.id, { title: "לא נחשף", clientVisible: false });

    const file = await getPortalFile(user);

    expect(file.dates.map((d) => d.title)).toEqual(["חידוש רישיון"]);
  });

  it("shows only documents that are opted in and not removed", async () => {
    const client = await createTestClient({ name: "Client Docs" });
    const other = await createTestClient({ name: "Client Other Docs" });
    const { user } = await createTestClientUser({ clientId: client.id });

    await seedDocument(client.id, { title: "פוליסת רכב" });
    await seedDocument(client.id, { title: "טיוטה", clientVisible: false });
    await seedDocument(client.id, { title: "הוסר", deleted: true });
    await seedDocument(other.id, { title: "של לקוח אחר" });

    const file = await getPortalFile(user);

    expect(file.documents.map((d) => d.title)).toEqual(["פוליסת רכב"]);
  });
});

describe("resolvePortalDocument()", () => {
  it("refuses a document id that belongs to another client", async () => {
    const mine = await createTestClient({ name: "Client Mine" });
    const theirs = await createTestClient({ name: "Client Theirs" });
    const { user } = await createTestClientUser({ clientId: mine.id });

    const theirDoc = await seedDocument(theirs.id, { title: "לא שלי" });

    await expect(resolvePortalDocument(user, theirDoc.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a document that was hidden from the client", async () => {
    const client = await createTestClient({ name: "Client Hidden Doc" });
    const { user } = await createTestClientUser({ clientId: client.id });

    const hidden = await seedDocument(client.id, { title: "טיוטה", clientVisible: false });

    await expect(resolvePortalDocument(user, hidden.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("preferences and digest", () => {
  it("lets a client admin write them and refuses a viewer", async () => {
    const client = await createTestClient({ name: "Client Prefs" });
    const { user: admin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });
    const { user: viewer } = await createTestClientUser({
      clientId: client.id,
      role: "VIEWER",
      email: `viewer.${Date.now()}@example.invalid`,
    });

    const saved = await updatePortalPreferences(admin, {
      contact: "  וואטסאפ בלבד  ",
      matters: "שהכול סגור לפני שאני שומע",
      never: "",
    });

    expect(saved.preferenceContact).toBe("וואטסאפ בלבד");
    // An empty box is a deliberate blank, not an untouched field.
    expect(saved.preferenceNever).toBeNull();
    expect(saved.preferencesUpdatedById).toBe(admin.id);

    await expect(updatePortalPreferences(viewer, { contact: "אני" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updatePortalDigest(viewer, "MONTHLY")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps an absent key untouched", async () => {
    const client = await createTestClient({ name: "Client Patch" });
    const { user: admin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    await updatePortalPreferences(admin, { contact: "בוקר בלבד", matters: "דיוק" });
    const after = await updatePortalPreferences(admin, { never: "בלי הפתעות" });

    expect(after.preferenceContact).toBe("בוקר בלבד");
    expect(after.preferenceMatters).toBe("דיוק");
    expect(after.preferenceNever).toBe("בלי הפתעות");
  });
});

describe("supplier recording", () => {
  it("stamps the date on the server and clears it with the name", async () => {
    const client = await createTestClient({ name: "Client Supplier Write" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const task = await seedTask(client.id, { title: "החלפת מנעול" });

    const recorded = await updateTask(admin, task.id, { supplierName: "  מנעולן דוד  ", supplierExperience: "GOOD" });
    expect(recorded.supplierName).toBe("מנעולן דוד");
    expect(recorded.supplierRecordedAt).not.toBeNull();

    // Re-recording keeps the original moment: the client's "when" is when
    // the work was closed, not when somebody last fixed a typo.
    const firstStamp = recorded.supplierRecordedAt;
    const renamed = await updateTask(admin, task.id, { supplierName: "מנעולן דויד" });
    expect(renamed.supplierRecordedAt?.getTime()).toBe(firstStamp?.getTime());

    const cleared = await updateTask(admin, task.id, { supplierName: null });
    expect(cleared.supplierName).toBeNull();
    expect(cleared.supplierRecordedAt).toBeNull();
    expect(cleared.supplierExperience).toBeNull();
  });
});

describe("portal summary", () => {
  it("builds a draft from the month's own records and cites them", async () => {
    const client = await createTestClient({ name: "Client Summary" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    const done = await seedTask(client.id, { title: "חידוש הביטוח", status: "DONE", clientVisible: true });
    await seedTask(client.id, { title: "עוד פתוחה", status: "IN_PROGRESS", clientVisible: true });

    const { periodStart, periodEnd } = monthRange(new Date());
    const draft = await buildSummaryDraft(client.id, periodStart, periodEnd);

    expect(draft.text).toContain("חידוש הביטוח");
    expect(draft.sourceTaskIds).toContain(done.id);
    // The open one is counted, not named - it did not happen yet.
    expect(draft.text).toContain("בטיפול");
    expect(draft.sourceTaskIds).not.toContain("nonexistent");

    const summary = await generatePortalSummary(admin, client.id);
    expect(summary.status).toBe("DRAFT");
  });

  it("stays invisible to the client until a person approves it", async () => {
    const client = await createTestClient({ name: "Client Approval" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: portalUser } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, { title: "משהו שנסגר", status: "DONE", clientVisible: true });
    const draft = await generatePortalSummary(admin, client.id);

    expect(await getApprovedSummaries(portalUser)).toHaveLength(0);

    const approved = await approvePortalSummary(admin, draft.id, "החודש סגרנו עבורך את חידוש הביטוח.");
    expect(approved.approvedById).toBe(admin.id);

    const visible = await getApprovedSummaries(portalUser);
    expect(visible).toHaveLength(1);
    expect(visible[0].draft).toBe("החודש סגרנו עבורך את חידוש הביטוח.");
  });

  it("un-approves when the draft is regenerated", async () => {
    const client = await createTestClient({ name: "Client Regenerate" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: portalUser } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, { title: "ראשונה", status: "DONE", clientVisible: true });
    const first = await generatePortalSummary(admin, client.id);
    await approvePortalSummary(admin, first.id);
    expect(await getApprovedSummaries(portalUser)).toHaveLength(1);

    // Something else closed, so the month's summary is rebuilt. The
    // signature does not survive that: it was on words nobody has read
    // since.
    await seedTask(client.id, { title: "שנייה", status: "DONE", clientVisible: true });
    const second = await generatePortalSummary(admin, client.id);

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("DRAFT");
    expect(second.approvedById).toBeNull();
    expect(await getApprovedSummaries(portalUser)).toHaveLength(0);
  });
});
