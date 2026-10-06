import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import {
  createCredential,
  deleteCredential,
  listCredentials,
  revealCredential,
  updateCredential,
  CredentialNotFoundError,
  StepUpRequiredError,
  RevealRateLimitedError,
  REVEAL_LIMIT_PER_HOUR,
} from "@/lib/app-domain/credentials";
import { stepUpWithPassword, StepUpFailedError, StepUpLockedError, STEP_UP_FAIL_LIMIT } from "@/lib/app-auth/step-up";
import { ForbiddenError } from "@/lib/app-auth/permissions";

// Lets one test make the audit write fail, to prove a reveal cannot
// outrun its own log.
const auditControl = vi.hoisted(() => ({ failOn: null as string | null }));
vi.mock("@/lib/app-auth/audit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/app-auth/audit")>();
  return {
    ...real,
    recordAudit: async (params: Parameters<typeof real.recordAudit>[0]) => {
      if (auditControl.failOn === params.action) throw new Error("audit store unavailable");
      return real.recordAudit(params);
    },
  };
});

// Credentials vault, end to end against Postgres
// (claude/credentials-vault-spec-2026-10-06.md, "בדיקות").

const SECRET = { username: "dana@example.com", password: "S3cret pass ", notes: "שאלת אבטחה: שם הכלב" };

beforeEach(() => {
  auditControl.failOn = null;
  delete process.env.GCP_VAULT_KMS_KEY;
  delete process.env.VERCEL_ENV;
  process.env.VAULT_LOCAL_KEK = process.env.VAULT_LOCAL_KEK ?? randomBytes(32).toString("base64");
});

async function employeeOn(clientId: string) {
  const made = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: made.user.id, clientId } });
  return made;
}

async function setup() {
  const clientA = await createTestClient({ name: "לקוח א" });
  const clientB = await createTestClient({ name: "לקוח ב" });
  const { user: onA, password } = await employeeOn(clientA.id);
  const { user: onB } = await employeeOn(clientB.id);
  const { id } = await createCredential(onA, { clientId: clientA.id, systemName: "ביטוח לאומי", url: "btl.gov.il", ...SECRET });
  return { clientA, clientB, onA, onB, password, id };
}

describe("storage", () => {
  it("stores no plain text, and the list carries no secret field", async () => {
    const { onA, clientA, id } = await setup();
    const raw = await prisma.clientCredential.findUniqueOrThrow({ where: { id } });
    const bytes = Buffer.concat([raw.secretCiphertext!, raw.wrappedDek!]).toString("latin1");
    expect(bytes).not.toContain("dana@example.com");
    expect(bytes).not.toContain("S3cret");
    expect(raw.url).toBe("https://btl.gov.il/");

    const list = await listCredentials(onA, clientA.id);
    expect(list).toHaveLength(1);
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/secretCiphertext|secretIv|secretTag|wrappedDek|kekRef|dana@|S3cret/);
    expect(list[0]).toMatchObject({ systemName: "ביטוח לאומי", hasUsername: true, hasPassword: true, hasNotes: true });
  });

  it("refuses a javascript: link", async () => {
    const { onA, clientA } = await setup();
    await expect(
      createCredential(onA, { clientId: clientA.id, systemName: "x", url: "javascript:alert(1)" }),
    ).rejects.toThrow(/http/);
  });

  it("audits creation with names and yes/no only", async () => {
    const { id } = await setup();
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { action: "credential.create", entityId: id } });
    expect(JSON.stringify(row.afterJson)).not.toMatch(/dana@|S3cret|כלב/);
  });
});

describe("who can see what", () => {
  it("shows an unassigned employee nothing, and calls the reveal not found", async () => {
    const { clientA, onB, id } = await setup();
    await expect(listCredentials(onB, clientA.id)).rejects.toBeInstanceOf(CredentialNotFoundError);
    await stepUpWithPassword(onB, "Tr0ub4dor&Zebra");
    await expect(revealCredential(onB, id)).rejects.toBeInstanceOf(CredentialNotFoundError);
    // The attempt itself is evidence.
    const denied = await prisma.auditEvent.findFirstOrThrow({ where: { action: "credential.reveal_denied", actorId: onB.id } });
    expect(denied.afterJson).toEqual({ reason: "not_assigned" });
  });

  it("gives a client user nothing, even for their own client", async () => {
    const { clientA, id } = await setup();
    const { user: clientUser } = await createTestUser({ role: "CLIENT_USER" });
    await expect(listCredentials(clientUser, clientA.id)).rejects.toThrow(ForbiddenError);
    await expect(revealCredential(clientUser, id)).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("lets an admin reveal on any client (decision 7)", async () => {
    const { id } = await setup();
    const { user: admin, password } = await createTestUser({ role: "ANKORA_ADMIN" });
    await stepUpWithPassword(admin, password);
    await expect(revealCredential(admin, id)).resolves.toMatchObject({ password: "S3cret pass " });
  });
});

describe("reveal", () => {
  it("refuses without a step-up and records the refusal", async () => {
    const { onA, id } = await setup();
    await expect(revealCredential(onA, id)).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(await prisma.auditEvent.count({ where: { action: "credential.reveal_denied", entityId: id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "credential.reveal" } })).toBe(0);
  });

  it("reveals inside the window, one audit row per reveal", async () => {
    const { onA, password, id } = await setup();
    await stepUpWithPassword(onA, password);
    expect(await revealCredential(onA, id)).toMatchObject(SECRET);
    await revealCredential(onA, id);
    expect(await prisma.auditEvent.count({ where: { action: "credential.reveal", entityId: id, actorId: onA.id } })).toBe(2);
    const row = await prisma.clientCredential.findUniqueOrThrow({ where: { id } });
    expect(row.lastRevealedById).toBe(onA.id);
  });

  it("closes the window after five minutes", async () => {
    const { onA, password, id } = await setup();
    const t0 = new Date();
    await stepUpWithPassword(onA, password, t0);
    await expect(revealCredential(onA, id, {}, new Date(t0.getTime() + 5 * 60_000 + 1))).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("closes the window when the password changes or sessions are disconnected", async () => {
    const { onA, password, id } = await setup();
    await stepUpWithPassword(onA, password);
    const bumped = await prisma.user.update({ where: { id: onA.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(revealCredential(bumped, id)).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("records the task, and refuses a task of another client", async () => {
    const { onA, password, id, clientA, clientB } = await setup();
    const taskA = await prisma.task.create({ data: { clientId: clientA.id, title: "חידוש קצבה" } });
    const taskB = await prisma.task.create({ data: { clientId: clientB.id, title: "אחר" } });
    await stepUpWithPassword(onA, password);
    await revealCredential(onA, id, { taskId: taskA.id });
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { action: "credential.reveal", entityId: id } });
    expect(row.afterJson).toMatchObject({ taskId: taskA.id });
    await expect(revealCredential(onA, id, { taskId: taskB.id })).rejects.toThrow(ForbiddenError);
  });

  it("refuses when the audit write fails: no log, no secret", async () => {
    const { onA, password, id } = await setup();
    await stepUpWithPassword(onA, password);
    auditControl.failOn = "credential.reveal";
    await expect(revealCredential(onA, id)).rejects.toThrow("audit store unavailable");
    const row = await prisma.clientCredential.findUniqueOrThrow({ where: { id } });
    expect(row.lastRevealedAt).toBeNull();
  });

  it("refuses a ciphertext copied onto another client's row", async () => {
    const { onB, id, clientB } = await setup();
    const { id: idB } = await createCredential(onB, { clientId: clientB.id, systemName: "בנק", password: "other" });
    const src = await prisma.clientCredential.findUniqueOrThrow({ where: { id } });
    await prisma.clientCredential.update({
      where: { id: idB },
      data: { secretCiphertext: src.secretCiphertext, secretIv: src.secretIv, secretTag: src.secretTag, wrappedDek: src.wrappedDek, kekRef: src.kekRef },
    });
    await stepUpWithPassword(onB, "Tr0ub4dor&Zebra");
    await expect(revealCredential(onB, idB)).rejects.toThrow();
  });

  it(`stops at ${REVEAL_LIMIT_PER_HOUR} reveals an hour`, async () => {
    const { onA, password, id } = await setup();
    await stepUpWithPassword(onA, password);
    await prisma.auditEvent.createMany({
      data: Array.from({ length: REVEAL_LIMIT_PER_HOUR }, () => ({
        actorId: onA.id,
        action: "credential.reveal",
        entityType: "ClientCredential",
        entityId: id,
      })),
    });
    await expect(revealCredential(onA, id)).rejects.toBeInstanceOf(RevealRateLimitedError);
  });
});

describe("step-up", () => {
  it(`locks after ${STEP_UP_FAIL_LIMIT} wrong passwords, and then refuses even the right one`, async () => {
    const { onA, password } = await setup();
    for (let i = 1; i < STEP_UP_FAIL_LIMIT; i++) {
      await expect(stepUpWithPassword(onA, "wrong")).rejects.toBeInstanceOf(StepUpFailedError);
    }
    await expect(stepUpWithPassword(onA, "wrong")).rejects.toBeInstanceOf(StepUpLockedError);
    await expect(stepUpWithPassword(onA, password)).rejects.toBeInstanceOf(StepUpLockedError);
    expect(await prisma.stepUpGrant.count({ where: { userId: onA.id } })).toBe(0);
  });
});

describe("edit and delete", () => {
  it("changes only what was typed, and the audit says which fields changed", async () => {
    const { onA, password, id } = await setup();
    const res = await updateCredential(onA, id, { password: "new-pass", username: "" });
    expect(res.changed).toEqual(["password"]);
    await stepUpWithPassword(onA, password);
    expect(await revealCredential(onA, id)).toMatchObject({ username: "dana@example.com", password: "new-pass", notes: SECRET.notes });
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { action: "credential.update", entityId: id } });
    expect(JSON.stringify(row.afterJson)).not.toContain("new-pass");
    expect(row.afterJson).toMatchObject({ changed: ["password"] });
  });

  it("clears a field only when asked to", async () => {
    const { onA, password, id } = await setup();
    await updateCredential(onA, id, { clear: ["notes"] });
    await stepUpWithPassword(onA, password);
    expect((await revealCredential(onA, id)).notes).toBeNull();
  });

  it("deletes the secret immediately and keeps the name for the trail", async () => {
    const { onA, clientA, id } = await setup();
    await deleteCredential(onA, id);
    const row = await prisma.clientCredential.findUniqueOrThrow({ where: { id } });
    expect(row.secretCiphertext).toBeNull();
    expect(row.wrappedDek).toBeNull();
    expect(row.systemName).toBe("ביטוח לאומי");
    expect(await listCredentials(onA, clientA.id)).toHaveLength(0);
  });

  it("refuses at the database a deleted row that still holds ciphertext", async () => {
    const { id } = await setup();
    await expect(prisma.clientCredential.update({ where: { id }, data: { deletedAt: new Date() } })).rejects.toThrow();
  });
});

describe("audit_events is append-only", () => {
  it("refuses UPDATE and DELETE", async () => {
    const { id } = await setup();
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: id } });
    await expect(prisma.auditEvent.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("still lets Postgres null the actor when a user row is hard-deleted", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.auditEvent.create({ data: { actorId: user.id, action: "login.success", entityType: "User", entityId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: user.id } });
    expect(row.actorId).toBeNull();
  });
});
