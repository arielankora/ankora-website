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

  console.log("Done. Demo accounts (all share the password below):");
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  ${superAdmin.email} (SUPER_ADMIN)`);
  console.log(`  ${ankoraAdmin.email} (ANKORA_ADMIN)`);
  console.log(`  ${employeeOne.email} (ANKORA_EMPLOYEE, assigned to ${clientA.name})`);
  console.log(`  ${employeeTwo.email} (ANKORA_EMPLOYEE, assigned to ${clientB.name})`);
  console.log(`  ${suspendedEmployee.email} (ANKORA_EMPLOYEE, SUSPENDED - login must be blocked)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
