import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import { createTask, updateTask } from "@/lib/app-domain/tasks";
import { saveTaskPlan } from "@/lib/app-domain/task-plans";
import {
  VENDOR_DECIDED_MESSAGE,
  decideVendorCheck,
  openOverdueVendorRuns,
  pendingVendorCheck,
} from "@/lib/app-domain/vendor-detections";

// P8 (3.11.2026): a task that connects a new vendor to the product is
// asked about, and the answer opens the subprocessor run. Against a real
// database, because what matters is what is recorded and opened:
//
//   - product work on the internal file is read; marketing there is not,
//   - a client's task is read whatever its category,
//   - a task is asked about once, however often it is edited,
//   - opening names the vendor on the run and links both tasks,
//   - the same vendor again is a note on its run, not a second run,
//   - nobody answering for a business day opens the run anyway.

const step = (title: string) => ({ title, mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null });

async function setup() {
  const internal = await prisma.client.create({ data: { name: "Ankora פנימי", isInternal: true } });
  const other = await createTestClient();
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: ops } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  for (const c of [internal, other]) {
    await prisma.userClientAccess.create({ data: { userId: ariel.id, clientId: c.id } });
    await prisma.userClientAccess.create({ data: { userId: ops.id, clientId: c.id } });
  }
  const product = await createTestCategory({ name: "פיתוח מוצר" });
  const marketing = await createTestCategory({ name: "שיווק" });
  const p8 = await prisma.process.create({
    data: { clientId: internal.id, seq: 8, code: "P8", title: "הוספת תת-מעבד חדש", status: "ACTIVE", ownerId: ariel.id },
  });
  await prisma.processVersion.create({
    data: { processId: p8.id, version: 1, status: "APPROVED", steps: [step("סיווג"), step("בקשת DPA")], approvedAt: new Date() },
  });
  return { internal, other, ariel, ops, product, marketing, p8 };
}

describe("noticing a new vendor", () => {
  it("asks about product work on the internal file, and not about marketing", async () => {
    const { internal, ops, product, marketing } = await setup();
    const dev = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Pipedrive לאפליקציה" });
    const check = await pendingVendorCheck(dev.id);
    expect(check?.vendor).toBe("Pipedrive");
    expect(check?.matched).toBe("לחבר + Pipedrive");

    const ads = await createTask(ops, { clientId: internal.id, categoryId: marketing.id, title: "לחבר את Lemlist לקמפיין" });
    expect(await pendingVendorCheck(ads.id)).toBeNull();
  });

  it("reads a client's task whatever its category", async () => {
    const { other, ops } = await setup();
    const t = await createTask(ops, { clientId: other.id, title: "חיבור Dialpad לשיחות של הלקוח" });
    expect((await pendingVendorCheck(t.id))?.vendor).toBe("Dialpad");
  });

  it("stays quiet on a vendor the security page already names", async () => {
    const { internal, ops, product } = await setup();
    const t = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Resend לתזכורות" });
    expect(await pendingVendorCheck(t.id)).toBeNull();
    expect(await prisma.vendorDetection.count()).toBe(0);
  });

  it("asks once per task, also when the task is edited or a plan is saved", async () => {
    const { internal, ops, product } = await setup();
    const t = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "מסך חדש" });
    expect(await pendingVendorCheck(t.id)).toBeNull();
    await updateTask(ops, t.id, { description: "כולל חיבור Twilio API" });
    expect((await pendingVendorCheck(t.id))?.vendor).toBe("Twilio");
    const saved = await saveTaskPlan(ops, t.id, { body: "**שלבים**\n1. להירשם ל-Notion", approved: false, origin: "MCP" });
    expect(saved.vendorCheck?.vendor).toBe("Twilio");
    expect(await prisma.vendorDetection.count({ where: { sourceTaskId: t.id } })).toBe(1);
  });

  it("finds it in a plan when the task itself says nothing", async () => {
    const { internal, ops, product } = await setup();
    const t = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "הקלטות שיחות" });
    const saved = await saveTaskPlan(ops, t.id, { body: "**שלבים**\n1. לחבר את Aircall דרך Webhook", approved: false, origin: "MCP" });
    expect(saved.vendorCheck?.vendor).toBe("Aircall");
  });
});

describe("deciding", () => {
  it("opens the P8 run for the vendor, on its owner, and links both tasks", async () => {
    const { internal, ops, ariel, product, p8 } = await setup();
    const t = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Pipedrive לאפליקציה" });
    const check = (await pendingVendorCheck(t.id))!;
    const out = await decideVendorCheck(ops, check.detectionId, "OPEN_RUN");
    expect(out.status).toBe("OPENED");

    const run = await prisma.task.findUniqueOrThrow({ where: { id: out.runTaskId! } });
    expect(run.processId).toBe(p8.id);
    expect(run.clientId).toBe(internal.id);
    expect(run.assignedToId).toBe(ariel.id);
    expect(run.title).toBe("P8 הוספת תת-מעבד חדש: Pipedrive");
    expect(run.description).toContain(`/app/tasks/${t.id}`);
    const note = await prisma.taskComment.findFirstOrThrow({ where: { taskId: t.id } });
    expect(note.body).toContain(`/app/tasks/${run.id}`);

    await expect(decideVendorCheck(ops, check.detectionId, "NOT_A_VENDOR")).rejects.toThrow(VENDOR_DECIDED_MESSAGE);
    expect(await pendingVendorCheck(t.id)).toBeNull();
  });

  it("notes the same vendor on its run instead of opening a second", async () => {
    const { internal, other, ops, product } = await setup();
    const first = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Pipedrive" });
    const opened = await decideVendorCheck(ops, (await pendingVendorCheck(first.id))!.detectionId, "OPEN_RUN");

    // Now known: a second task about it is noted, without a question.
    const again = await createTask(ops, { clientId: other.id, title: "לחבר את Pipedrive ללקוח" });
    expect(await pendingVendorCheck(again.id)).toBeNull();
    const row = await prisma.vendorDetection.findUniqueOrThrow({ where: { sourceTaskId: again.id } });
    expect(row.status).toBe("EXISTING");
    expect(row.runTaskId).toBe(opened.runTaskId);
    expect(await prisma.taskComment.count({ where: { taskId: opened.runTaskId! } })).toBe(1);
    expect(await prisma.task.count({ where: { processId: { not: null }, parentId: null } })).toBe(1);
  });

  it("asks for a name when the text had none, and records a dismissal", async () => {
    const { internal, ops, product } = await setup();
    const t = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את המערכת של הבנק" });
    const check = (await pendingVendorCheck(t.id))!;
    expect(check.vendor).toBeNull();
    await expect(decideVendorCheck(ops, check.detectionId, "OPEN_RUN")).rejects.toThrow("שם הספק");
    const out = await decideVendorCheck(ops, check.detectionId, "NOT_A_VENDOR");
    expect(out.status).toBe("NOT_A_VENDOR");
    const row = await prisma.vendorDetection.findUniqueOrThrow({ where: { id: check.detectionId } });
    expect(row.decidedById).toBe(ops.id);
  });

  it("is refused to someone without access to the task's client", async () => {
    const { other, ops } = await setup();
    const t = await createTask(ops, { clientId: other.id, title: "לחבר את Dialpad" });
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(decideVendorCheck(stranger, (await pendingVendorCheck(t.id))!.detectionId, "OPEN_RUN")).rejects.toThrow("גישה");
  });
});

describe("nobody answers", () => {
  it("opens the run after a business day, and not before", async () => {
    const { internal, ops, product } = await setup();
    const t = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Pipedrive" });
    // Created on Monday 2.11.2026.
    await prisma.vendorDetection.updateMany({ data: { createdAt: new Date("2026-11-02T08:00:00Z") } });

    expect((await openOverdueVendorRuns(new Date("2026-11-03T05:00:00Z"))).opened).toBe(0);
    const out = await openOverdueVendorRuns(new Date("2026-11-04T05:00:00Z"));
    expect(out.opened).toBe(1);
    const row = await prisma.vendorDetection.findUniqueOrThrow({ where: { sourceTaskId: t.id } });
    expect(row.status).toBe("OPENED");
    expect(row.autoOpened).toBe(true);
    expect(row.decidedById).toBeNull();
  });

  it("opens nothing for a task dropped or deleted while it waited, and still opens for a finished one", async () => {
    const { internal, ops, product } = await setup();
    const dropped = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Pipedrive" });
    const deleted = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Dialpad" });
    const finished = await createTask(ops, { clientId: internal.id, categoryId: product.id, title: "לחבר את Aircall" });
    await updateTask(ops, dropped.id, { status: "ARCHIVED" });
    await prisma.task.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await updateTask(ops, finished.id, { status: "DONE" });
    await prisma.vendorDetection.updateMany({ data: { createdAt: new Date("2026-11-02T08:00:00Z") } });

    const out = await openOverdueVendorRuns(new Date("2026-11-04T05:00:00Z"));
    expect(out.opened).toBe(1);
    const status = async (id: string) => (await prisma.vendorDetection.findUniqueOrThrow({ where: { sourceTaskId: id } })).status;
    expect(await status(dropped.id)).toBe("PENDING");
    expect(await status(deleted.id)).toBe("PENDING");
    expect(await status(finished.id)).toBe("OPENED");
  });
});
