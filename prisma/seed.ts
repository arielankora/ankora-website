// Phase 1 demo fixtures - NOT run automatically against any environment.
// Spec section 0 / 21.5: demo data must never reach Production. This
// script is invoked manually and only against a local/dev/preview
// database:
//
//   DATABASE_URL="postgresql://...dev-db..." npm run db:seed
//
// Every seeded record's name is prefixed "[DEMO]" so it is unmistakable
// in the UI and trivially identifiable/removable if it ever ends up
// somewhere it shouldn't. Scope is deliberately Phase 1 only - users,
// clients, categories, and client access - no TimeEntry/HourBank/etc.
// fixtures, since those entities don't exist until Phase 2+.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/app-auth/password";

const prisma = new PrismaClient();

// Single shared demo password across all seeded accounts, only ever valid
// against a local/dev database - never use this constant as a hint about
// production password policy.
const DEMO_PASSWORD = "DemoPass!2026";

/// Not a hash OF anything - see the note where it is used. Fixed so the
/// seed is idempotent, and obviously synthetic so nobody mistakes it for
/// a credential.
const DEMO_GRANT_HASH = "demo-grant-not-a-real-token-hash-0000000000000000000000000000";

async function main() {
  console.log("Seeding Phase 1 demo fixtures...");
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const superAdmin = await prisma.user.upsert({
    where: { email: "demo.superadmin@ankora.co.il" },
    update: {},
    create: {
      name: "[DEMO] מנהל-על",
      email: "demo.superadmin@ankora.co.il",
      username: "demo.superadmin",
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  const ankoraAdmin = await prisma.user.upsert({
    where: { email: "demo.admin@ankora.co.il" },
    update: {},
    create: {
      name: "[DEMO] מנהל Ankora",
      email: "demo.admin@ankora.co.il",
      username: "demo.admin",
      passwordHash,
      role: "ANKORA_ADMIN",
      status: "ACTIVE",
    },
  });

  const employeeOne = await prisma.user.upsert({
    where: { email: "demo.employee1@ankora.co.il" },
    update: {},
    create: {
      name: "[DEMO] עובד Ankora - נועה",
      email: "demo.employee1@ankora.co.il",
      username: "demo.employee1",
      passwordHash,
      role: "ANKORA_EMPLOYEE",
      status: "ACTIVE",
    },
  });

  const employeeTwo = await prisma.user.upsert({
    where: { email: "demo.employee2@ankora.co.il" },
    update: {},
    create: {
      name: "[DEMO] עובד Ankora - איתי",
      email: "demo.employee2@ankora.co.il",
      username: "demo.employee2",
      passwordHash,
      role: "ANKORA_EMPLOYEE",
      status: "ACTIVE",
    },
  });

  // One suspended account, so the "suspended user is blocked at login"
  // acceptance criterion has a ready-made fixture to test against.
  const suspendedEmployee = await prisma.user.upsert({
    where: { email: "demo.suspended@ankora.co.il" },
    update: {},
    create: {
      name: "[DEMO] עובד מושהה",
      email: "demo.suspended@ankora.co.il",
      username: "demo.suspended",
      passwordHash,
      role: "ANKORA_EMPLOYEE",
      status: "SUSPENDED",
    },
  });

  const clientA = await prisma.client.upsert({
    where: { id: "demo-client-a" },
    update: {},
    create: {
      id: "demo-client-a",
      name: "[DEMO] חברת אורביט בע\"מ",
      legalName: "אורביט טכנולוגיות בע\"מ",
      status: "ACTIVE",
      primaryContact: "רותם כהן",
    },
  });

  const clientB = await prisma.client.upsert({
    where: { id: "demo-client-b" },
    update: {},
    create: {
      id: "demo-client-b",
      name: "[DEMO] קבוצת מרידיאן",
      status: "ACTIVE",
      primaryContact: "דניאל לוי",
    },
  });

  await prisma.category.upsert({
    where: { id: "demo-category-meetings" },
    update: {},
    create: {
      id: "demo-category-meetings",
      name: "[DEMO] פגישות ותיאומים",
      visibility: "GLOBAL",
      sortOrder: 1,
    },
  });

  await prisma.category.upsert({
    where: { id: "demo-category-research" },
    update: {},
    create: {
      id: "demo-category-research",
      name: "[DEMO] מחקר ותכנון",
      visibility: "GLOBAL",
      sortOrder: 2,
    },
  });

  await prisma.category.upsert({
    where: { id: "demo-category-client-a-onboarding" },
    update: {},
    create: {
      id: "demo-category-client-a-onboarding",
      name: "[DEMO] קליטת לקוח - אורביט",
      visibility: "CLIENT",
      clientId: clientA.id,
      sortOrder: 1,
    },
  });

  // Client isolation fixture: employeeOne is assigned to clientA only,
  // employeeTwo to clientB only - useful for testing that an employee
  // cannot see/report against a client they aren't assigned to.
  await prisma.userClientAccess.upsert({
    where: { userId_clientId: { userId: employeeOne.id, clientId: clientA.id } },
    update: {},
    create: { userId: employeeOne.id, clientId: clientA.id },
  });

  await prisma.userClientAccess.upsert({
    where: { userId_clientId: { userId: employeeTwo.id, clientId: clientB.id } },
    update: {},
    create: { userId: employeeTwo.id, clientId: clientB.id },
  });

  await prisma.userClientAccess.upsert({
    where: { userId_clientId: { userId: ankoraAdmin.id, clientId: clientA.id } },
    update: {},
    create: { userId: ankoraAdmin.id, clientId: clientA.id },
  });

  // Phase 9 gap-fix (docs/adr/0001 section 17.2): demo Tasks across every
  // TaskStatus value, and a couple of demo Notification rows, so the new
  // /app/tasks and /app/notifications screens have something to show
  // right after a fresh seed - matching spec 21.5's test-data spirit
  // (every screen should be non-empty for a demo login).
  await prisma.task.upsert({
    where: { id: "demo-task-onboarding-kickoff" },
    update: {},
    create: {
      id: "demo-task-onboarding-kickoff",
      clientId: clientA.id,
      categoryId: "demo-category-client-a-onboarding",
      title: "[DEMO] פגישת פתיחה עם אורביט",
      status: "DONE",
    },
  });
  await prisma.task.upsert({
    where: { id: "demo-task-research-competitors" },
    update: {},
    create: {
      id: "demo-task-research-competitors",
      clientId: clientA.id,
      categoryId: "demo-category-research",
      title: "[DEMO] מיפוי מתחרים",
      status: "IN_PROGRESS",
    },
  });
  await prisma.task.upsert({
    where: { id: "demo-task-meridian-weekly" },
    update: {},
    create: {
      id: "demo-task-meridian-weekly",
      clientId: clientB.id,
      categoryId: "demo-category-meetings",
      title: "[DEMO] סנכרון שבועי - מרידיאן",
      status: "OPEN",
    },
  });
  await prisma.task.upsert({
    where: { id: "demo-task-old-proposal" },
    update: {},
    create: {
      id: "demo-task-old-proposal",
      clientId: clientB.id,
      title: "[DEMO] הצעת מחיר ישנה",
      status: "ARCHIVED",
    },
  });

  await prisma.notification.upsert({
    where: { id: "demo-notification-long-timer" },
    update: {},
    create: {
      id: "demo-notification-long-timer",
      userId: employeeOne.id,
      type: "long_running_timer",
      title: "[DEMO] טיימר רץ זמן ארוך",
      body: "הטיימר עבור אורביט טכנולוגיות רץ כבר 9 שעות ברצף. בדקו אם יש לעצור אותו.",
      entityType: "TimeEntry",
      entityId: "demo-timer-entry",
    },
  });
  await prisma.notification.upsert({
    where: { id: "demo-notification-read" },
    update: {},
    create: {
      id: "demo-notification-read",
      userId: employeeOne.id,
      type: "long_running_timer",
      title: "[DEMO] טיימר רץ זמן ארוך (נקרא)",
      body: "התראה קודמת לדוגמה, כבר סומנה כנקראת.",
      entityType: "TimeEntry",
      entityId: "demo-timer-entry-old",
      readAt: new Date(),
    },
  });

  // A Claude connection for the Ankora Admin, so the "disconnect" path on
  // the Profile and Integrations screens has something to disconnect.
  //
  // The browser suite needs a grant to exist before it can test revoking
  // one, and an OAuth grant would mean seeding a whole authorization
  // flow. A personal access token is the same thing from the screen's
  // point of view - one row, one label, one revoke button - and it is
  // one insert.
  //
  // `tokenHash` is a SHA-256-shaped string that hashes nothing: no real
  // token exists for it, so it cannot authenticate anything. That is
  // deliberate. A seeded credential that actually worked would be a
  // usable key sitting in a public repository, which is a worse problem
  // than the one it solves.
  await prisma.mcpAccessToken.upsert({
    where: { tokenHash: DEMO_GRANT_HASH },
    update: {},
    create: {
      userId: ankoraAdmin.id,
      label: "[DEMO] MacBook Air",
      tokenHash: DEMO_GRANT_HASH,
      tokenVersion: 0,
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    },
  });

  // A Client Admin, and a scheduled report for them to manage.
  //
  // Spec 13 gives a Client Admin one write capability of their own -
  // editing who a scheduled report is emailed to - and it is the only
  // write path in the product that belongs to a client-side user rather
  // than to Ankora staff. It had no browser coverage because it had no
  // fixture: the seed created no ClientUser at all, so there was nobody
  // to sign in as and nothing for them to edit.
  //
  // Both rows are scoped to clientA, so a Client Admin of clientA
  // attempting anything against clientB remains a genuine cross-client
  // test rather than a vacuous one.
  const clientAdminUser = await prisma.user.upsert({
    where: { email: "demo.clientadmin@ankora.co.il" },
    update: {},
    create: {
      name: "[DEMO] מנהל לקוח - אורביט",
      email: "demo.clientadmin@ankora.co.il",
      username: "demo.clientadmin",
      passwordHash,
      role: "CLIENT_USER",
      status: "ACTIVE",
    },
  });

  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: clientA.id, userId: clientAdminUser.id } },
    update: { role: "ADMIN" },
    create: { userId: clientAdminUser.id, clientId: clientA.id, role: "ADMIN" },
  });

  await prisma.reportSchedule.upsert({
    where: { id: "demo-report-schedule-orbit" },
    update: {},
    create: {
      id: "demo-report-schedule-orbit",
      clientId: clientA.id,
      reportType: "MONTHLY_DETAILED",
      frequency: "MONTHLY",
      recipients: ["demo.clientadmin@ankora.co.il"],
      dayOfMonth: 1,
    },
  });

  console.log("Done. Demo accounts (all share the password below):");
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  ${superAdmin.email} (SUPER_ADMIN)`);
  console.log(`  ${ankoraAdmin.email} (ANKORA_ADMIN)`);
  console.log(`  ${employeeOne.email} (ANKORA_EMPLOYEE, assigned to ${clientA.name})`);
  console.log(`  ${employeeTwo.email} (ANKORA_EMPLOYEE, assigned to ${clientB.name})`);
  console.log(`  ${suspendedEmployee.email} (ANKORA_EMPLOYEE, SUSPENDED - login must be blocked)`);
  console.log(`  ${clientAdminUser.email} (CLIENT_USER, Client Admin of ${clientA.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
