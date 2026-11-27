import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// System issues (27.11.2026, silent failures plan, stage 1b): the issues and
// the nightly runs through the connector, as the nightly analysis reads them.
// Admins get them; anyone else gets the domain's refusal in its own words,
// never "unexpected server error". An email issue's subject never reaches
// Claude. A note and a pull request link can be left; closing is the screen's.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return { ...real, sendEmail: vi.fn(async () => ({ ok: true })) };
});

import { registerAnkoraTools } from "@/lib/mcp/tools";
import { resolveSystemIssue } from "@/lib/app-domain/system-issues";
import { EMAIL_SUBJECT_MARK } from "@/lib/email";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Validated = { value?: unknown; issues?: readonly { message: string }[] };
type Schema = { "~standard"?: { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema: Schema; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema: Schema }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  const validated = await tool.schema["~standard"]!.validate(args);
  if (validated.issues) throw new Error(`schema refused ${name}: ${validated.issues.map((i) => i.message).join("; ")}`);
  return tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
}
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

async function seed() {
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: worker } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const now = new Date();
  const email = await prisma.systemIssue.create({
    data: { area: "email", key: "provider-503", title: "מייל לא נשלח", detail: `Resend API error 503${EMAIL_SUBJECT_MARK}דוח חודשי ללקוח סודי`, severity: "CRITICAL", firstSeenAt: now, lastSeenAt: now },
  });
  const old = await prisma.systemIssue.create({
    data: { area: "cron", key: "mail-waits:sweep", title: "שלב נכשל", severity: "CRITICAL", firstSeenAt: new Date(now.getTime() - 72 * 3600_000), lastSeenAt: new Date(now.getTime() - 72 * 3600_000) },
  });
  await prisma.cronRun.create({ data: { job: "comms-recordings", ok: false, finishedAt: now, summary: { failedSteps: ["reconcile"] } } });
  return { admin, worker, email, old };
}

describe("list_system_issues through the connector", () => {
  it("gives an admin the open issues, without an email's subject, and the nightly runs", async () => {
    const { admin } = await seed();
    const body = json(await call(admin, "list_system_issues", {}));
    expect(body.url).toContain("/app/system-issues");
    expect(body.open).toHaveLength(2);
    const email = body.open.find((i: { area: string }) => i.area === "email");
    expect(email.detail).toBe("Resend API error 503");
    expect(JSON.stringify(body)).not.toContain("לקוח סודי");
    const comms = body.nightlyJobs.find((j: { job: string }) => j.job === "comms-recordings");
    expect(comms.lastRun).toMatchObject({ ok: false, failedSteps: ["reconcile"] });
    expect(body.nightlyJobs.find((j: { job: string }) => j.job === "mail-waits").lastRun).toBeNull();
  });

  it("reads only the last day when asked", async () => {
    const { admin } = await seed();
    const body = json(await call(admin, "list_system_issues", { sinceHours: 24 }));
    expect(body.open.map((i: { key: string }) => i.key)).toEqual(["provider-503"]);
  });

  it("lists what a person closed", async () => {
    const { admin, old } = await seed();
    await resolveSystemIssue(admin, old.id, "תוקן ב-#700");
    const body = json(await call(admin, "list_system_issues", { status: "RESOLVED" }));
    expect(body.open).toEqual([]);
    expect(body.resolved[0]).toMatchObject({ key: "mail-waits:sweep", note: "תוקן ב-#700", status: "RESOLVED" });
  });

  it("refuses an employee in the domain's words", async () => {
    const { worker } = await seed();
    const result = await call(worker, "list_system_issues", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("רק מנהלים רואים את תקלות המערכת");
    expect(result.content[0].text).not.toContain("unexpected");
  });
});

describe("annotate_system_issue through the connector", () => {
  it("saves a note and a pull request link, and leaves the issue open", async () => {
    const { admin, email } = await seed();
    const url = "https://github.com/arielankora/ankora-website/pull/700";
    const body = json(await call(admin, "annotate_system_issue", { issueId: email.id, note: "מפתח Resend פג", prUrl: url }));
    expect(body.saved).toBe(true);
    expect(body.issue.detail).toBe("Resend API error 503");
    const row = await prisma.systemIssue.findUniqueOrThrow({ where: { id: email.id } });
    expect(row).toMatchObject({ note: "מפתח Resend פג", prUrl: url, status: "OPEN" });
    expect(await prisma.auditEvent.count({ where: { action: "system_issue.annotated", entityId: email.id } })).toBe(1);
  });

  it("refuses a link that is not a pull request of Ankora's, in the domain's words", async () => {
    const { admin, email } = await seed();
    const result = await call(admin, "annotate_system_issue", { issueId: email.id, prUrl: "https://example.com/x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("בקשת מיזוג בריפו של אנקורה");
  });

  it("refuses an empty call and an unknown issue in the domain's words", async () => {
    const { admin, email } = await seed();
    expect((await call(admin, "annotate_system_issue", { issueId: email.id })).content[0].text).toContain("צריך הערה או קישור");
    expect((await call(admin, "annotate_system_issue", { issueId: "nope", note: "x" })).content[0].text).toContain("התקלה לא נמצאה");
  });
});
