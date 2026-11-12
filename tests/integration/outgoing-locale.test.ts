import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR 0006, outgoing channels (part A): what the app sends to a person
// with an account goes out in that person's language. One case per kind
// of channel: a bell row, a transactional email, the morning digest, the
// urgent message through lib/notify, and an email to a typed-in address
// list. For each, an "en" reader gets English and an "he" reader gets the
// Hebrew they always got.

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask } from "@/lib/app-domain/tasks";
import { sendDailyTaskDigest } from "@/lib/app-domain/task-digest";
import { requestPasswordReset } from "@/lib/app-auth/password-reset";
import { sendVaultAlert } from "@/lib/vault/alerts";
import { sendEmail } from "@/lib/email";

const WEDNESDAY = new Date("2026-03-11T06:00:00+02:00");
const savedKey = process.env.RESEND_API_KEY;
const savedVault = process.env.VAULT_ALERT_EMAIL;

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "msg" });
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
  if (savedVault === undefined) delete process.env.VAULT_ALERT_EMAIL;
  else process.env.VAULT_ALERT_EMAIL = savedVault;
});

async function staff(clientId: string, locale: "he" | "en", name: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { locale, name } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return updated;
}

const sentTo = (email: string) => vi.mocked(sendEmail).mock.calls.map(([i]) => i).filter((i) => i.to.includes(email));

describe("a bell row", () => {
  it("is written in the recipient's language when it is created", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const hadas = await staff(client.id, "he", "הדס");
    const dana = await staff(client.id, "en", "Dana");
    const anna = await staff(client.id, "he", "אנה");

    await createTask(hadas, { clientId: client.id, title: "לתאם ביקור", assignedToId: dana.id });
    await createTask(hadas, { clientId: client.id, title: "לתאם ביקור", assignedToId: anna.id });

    const [en] = await prisma.notification.findMany({ where: { userId: dana.id } });
    expect(en.title).toBe("New task for you");
    expect(en.body).toBe("לתאם ביקור · אורביט");
    const [he] = await prisma.notification.findMany({ where: { userId: anna.id } });
    expect(he.title).toBe("משימה חדשה אצלך");
    expect(he.body).toBe("לתאם ביקור · אורביט");
  });
});

describe("a transactional email", () => {
  it("is in the person's language, laid out in its direction", async () => {
    const { user: en } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.user.update({ where: { id: en.id }, data: { locale: "en", name: "Dana" } });
    const { user: he } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await requestPasswordReset(en.email);
    await requestPasswordReset(he.email);

    const [toEn] = sentTo(en.email);
    expect(toEn.subject).toBe("Choose a new password for Ankora");
    expect(toEn.text).toContain("Hi Dana,");
    expect(toEn.html).toContain('<html dir="ltr" lang="en">');
    const [toHe] = sentTo(he.email);
    expect(toHe.subject).toBe("בחירת סיסמה חדשה למערכת Ankora");
    expect(toHe.html).toContain('<html dir="rtl" lang="he">');
  });
});

describe("the morning digest", () => {
  it("is in each person's language", async () => {
    const client = await createTestClient();
    const dana = await staff(client.id, "en", "Dana");
    const anna = await staff(client.id, "he", "אנה");
    for (const person of [dana, anna]) {
      await createTask(person, {
        clientId: client.id,
        title: "Late work",
        assignedToId: person.id,
        dueDate: new Date("2026-03-01T10:00:00+02:00"),
      });
    }

    await sendDailyTaskDigest(WEDNESDAY);

    const [toEn] = sentTo(dana.email);
    expect(toEn.subject).toBe("10 days late: Late work");
    expect(toEn.text).toContain("Good morning Dana,");
    expect(toEn.html).toContain('<html dir="ltr" lang="en">');
    const [toHe] = sentTo(anna.email);
    expect(toHe.subject).toBe("באיחור 10 ימים: Late work");
    expect(toHe.text).toContain("בוקר טוב אנה,");
  });
});

describe("an urgent message through the delivery channels", () => {
  it("is worded and laid out for its recipient", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const client = await createTestClient({ name: "Orbit" });
    const hadas = await staff(client.id, "he", "הדס");
    const dana = await staff(client.id, "en", "Dana");
    const anna = await staff(client.id, "he", "אנה");

    await createTask(hadas, { clientId: client.id, title: "Renew", assignedToId: dana.id, priority: "URGENT" });
    await createTask(hadas, { clientId: client.id, title: "Renew", assignedToId: anna.id, priority: "URGENT" });

    const [toEn] = sentTo(dana.email);
    expect(toEn.subject).toBe("Urgent task for you: Renew · Orbit");
    expect(toEn.text).toContain("From הדס");
    expect(toEn.html).toContain('dir="ltr"');
    const [toHe] = sentTo(anna.email);
    expect(toHe.subject).toBe("משימה דחופה אצלך: Renew · Orbit");
    expect(toHe.html).toContain('dir="rtl"');
    // The bell row that goes with it, in the same language.
    const bell = await prisma.notification.findFirst({ where: { userId: dana.id } });
    expect(bell?.title).toBe("Urgent task for you");
  });
});

describe("an email to a typed-in address list", () => {
  it("goes once per language; an address that is no app user keeps Hebrew", async () => {
    const { user: en } = await createTestUser({ role: "ANKORA_ADMIN" });
    await prisma.user.update({ where: { id: en.id }, data: { locale: "en" } });
    const { user: he } = await createTestUser({ role: "ANKORA_ADMIN" });
    process.env.VAULT_ALERT_EMAIL = `${he.email},outside@example.test,${en.email.toUpperCase()}`;

    await sendVaultAlert((t) => ({ subject: t("vault.lockout.subject"), lines: [t("vault.lockout.line2", { minutes: "15" })] }));

    const calls = vi.mocked(sendEmail).mock.calls.map(([i]) => i);
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toEqual([he.email, "outside@example.test"]);
    expect(calls[0].subject).toBe("כספת הגישות: נעילת אימות");
    expect(calls[1].to).toEqual([en.email.toUpperCase()]);
    expect(calls[1].subject).toBe("Credentials vault: Verification lockout");
    expect(calls[1].text).toBe("Reveals are locked for this user for 15 minutes.\n\nThe full details are in the audit log.");
    expect(await prisma.emailDelivery.count({ where: { template: "vault_alert" } })).toBe(2);
  });
});
