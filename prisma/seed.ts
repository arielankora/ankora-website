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
  // Portal phase 1: the demo client's tasks are what the portal home
  // screen is made of, so the ones belonging to the client with a portal
  // user are opted in and given the sentence a client would actually
  // read. `update` carries them too (unlike the rest of this file's
  // `update: {}`), so an existing demo database picks the fields up on
  // the next seed instead of showing an empty portal.
  // Team adoption: a finished promise now carries what came of it, and
  // the date it closed. Without both, the portal's activity screen and
  // the monthly summary have only a title to show for completed work -
  // which is the gap the definition of done exists to close.
  const KICKOFF_PORTAL = {
    clientVisible: true,
    clientTitle: "[DEMO] פגישת הפתיחה שלך",
    clientOutcome: "[DEMO] נפגשנו, מיפינו את כל מה שרץ אצלך, ויצאנו עם תוכנית לשלושת החודשים הראשונים.",
    completedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
  };
  await prisma.task.upsert({
    where: { id: "demo-task-onboarding-kickoff" },
    update: KICKOFF_PORTAL,
    create: {
      id: "demo-task-onboarding-kickoff",
      clientId: clientA.id,
      categoryId: "demo-category-client-a-onboarding",
      title: "[DEMO] פגישת פתיחה עם אורביט",
      status: "DONE",
      ...KICKOFF_PORTAL,
    },
  });
  // Assigned to the account manager on this client, who is also the
  // account the browser suite signs in as - so "המשימות שלי" on the home
  // screen and the "שלי" filter both have a row, and the timer screen has
  // a promise to offer when a timer stops.
  //
  // Tasks phase 1: this is the row the task screen is demonstrated on, so
  // it carries the two fields that screen exists for. A description in
  // the Markdown subset the field actually supports (lib/markdown-lite.ts
  // - emphasis, a list, a link, and nothing else), because a demo that
  // only ever shows one paragraph teaches people the field holds one
  // paragraph. `startedAt` is left to the server: the status is already
  // IN_PROGRESS here, and writing a start date beside it in a seed would
  // be the one place in the product where that column is not the
  // server's.
  const RESEARCH_PORTAL = {
    clientVisible: true,
    clientTitle: "[DEMO] בדיקת שלושה ספקים והשוואה",
    assignedToId: ankoraAdmin.id,
    priority: "HIGH" as const,
    description: [
      "שלושה ספקים להשוואה, **עד יום חמישי**:",
      "",
      "- אלפא, הצעה קיימת מ-2024, אסמכתא `INV-2024-118`",
      "- ביתא, פנינו ולא חזרו",
      "- גמא, הגיע דרך המלצה של הלקוח",
      "",
      "מה שחשוב ללקוח הוא *זמן האספקה*, לא המחיר. פרטי ההתקשרות של אלפא נמצאים",
      "ב[אתר שלהם](https://example.com/alpha).",
    ].join("\n"),
  };
  await prisma.task.upsert({
    where: { id: "demo-task-research-competitors" },
    update: RESEARCH_PORTAL,
    create: {
      id: "demo-task-research-competitors",
      clientId: clientA.id,
      categoryId: "demo-category-research",
      title: "[DEMO] מיפוי מתחרים",
      status: "IN_PROGRESS",
      ...RESEARCH_PORTAL,
    },
  });

  // One promise in each of the two states the home screen is built
  // around: something waiting on the client (the only block that may use
  // gold), and something still with us.
  const WAITING_PORTAL = {
    clientVisible: true,
    clientTitle: "[DEMO] אישור מועד לביקור הטכנאי",
    waitingOnClientSince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  };
  await prisma.task.upsert({
    where: { id: "demo-task-waiting-on-client" },
    update: WAITING_PORTAL,
    create: {
      id: "demo-task-waiting-on-client",
      clientId: clientA.id,
      categoryId: "demo-category-client-a-onboarding",
      title: "[DEMO] ממתין לאישור תאריך מהלקוח",
      status: "IN_PROGRESS",
      ...WAITING_PORTAL,
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
  // Tasks phase 1: the task screen's own fixture, and nothing else's.
  //
  // The browser spec for that screen needs a task it can rename,
  // re-prioritise, run a clock on and close, and every other seeded task
  // is read by some other spec - the research promise is what the home
  // screen and the "שלי" filter assert against, and the waiting one is
  // what the portal reads. A spec that closes a task another spec expects
  // open is a suite that fails by running order, which is the hardest
  // kind of failure to believe.
  //
  // It carries a category on purpose. A time entry cannot exist without
  // one, so the timer refuses to start from a task that has none - and a
  // fixture without a category would make that refusal look like a broken
  // button rather than the rule it is.
  //
  // Internal, not a promise: the spec opts it in itself, because becoming
  // client-visible and then needing a sentence to close is the sequence
  // worth proving.
  await prisma.task.upsert({
    where: { id: "demo-task-screen-fixture" },
    update: {},
    create: {
      id: "demo-task-screen-fixture",
      clientId: clientB.id,
      categoryId: "demo-category-meetings",
      title: "[DEMO] תיאום מול ועד הבית",
      status: "OPEN",
      priority: "NORMAL",
      description: [
        "הפרטים שצריך כדי להרים את זה, **בלי לשאול אף אחד**:",
        "",
        "- ועד הבית, מיכל, אסמכתא `VA-2026-07`",
        "- המפתח נמצא אצל השכן מקומה 2",
        "",
        "הטופס עצמו נמצא [באתר העירייה](https://example.com/vaad).",
      ].join("\n"),
    },
  });

  // Tasks phase 2's own fixture, read by the supervision spec and by
  // nothing else.
  //
  // Supervised by the Ankora Admin, because that is who the browser suite
  // signs in as. Worth stating plainly, because the file it signs in
  // with is called `employee.json` and the account inside it is
  // `demo.admin@ankora.co.il` - see qa/e2e/auth.setup.ts. The first
  // version of this fixture named employee1 on the strength of that file
  // name and cost a full CI round: the nav row, the count beside it and
  // the approval buttons all exist only for the person a task defers to,
  // so the spec loaded a supervision screen that was correctly empty.
  //
  // Which also means this fixture must sit on a client that person can
  // reach. The admin reaches every active client by role; employee1
  // holds client A only, and this task is on client B.
  //
  // Internal rather than client-visible on purpose. A promise cannot be
  // sent for approval without its outcome sentence, and that rule has
  // its own tests; making this one a promise would mean every run of the
  // approval flow also re-proving the outcome gate, which is the sort of
  // coupling that makes one failure look like two.
  await prisma.task.upsert({
    where: { id: "demo-task-supervised-fixture" },
    update: {},
    create: {
      id: "demo-task-supervised-fixture",
      clientId: clientB.id,
      title: "[DEMO] החלפת ספק ניקיון",
      status: "OPEN",
      priority: "NORMAL",
      supervisorId: ankoraAdmin.id,
      requiresApproval: true,
      description: "מחיר מול שניים אחרים, ואז אישור לפני החתימה.",
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
      // The Super Admin, not the Ankora Admin. /app/integrations is
      // gated on integration.manage, which is Super-Admin-only, and the
      // card shows the CALLING user's own grants - so a grant on anyone
      // else is a grant the browser test can never see.
      userId: superAdmin.id,
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

  // Portal phase 2. The demo client gets the three fields the portal
  // reads (an account manager, the dedicated WhatsApp line, an agreed
  // ceiling) and one open decision above that ceiling - which is the
  // state the decisions screen exists for, and the fixture its browser
  // test signs in to answer.
  await prisma.client.update({
    where: { id: clientA.id },
    data: {
      accountManagerId: ankoraAdmin.id,
      whatsappNumber: "052-000-0000",
      approvalCeilingMinor: 50000,
    },
  });

  const existingDecision = await prisma.decision.findFirst({ where: { id: "demo-decision-technician" } });
  if (!existingDecision) {
    await prisma.decision.create({
      data: {
        id: "demo-decision-technician",
        clientId: clientA.id,
        question: "[DEMO] באיזה מועד לקבוע את ביקור הטכנאי?",
        background: "שני מועדים פנויים השבוע. המוקדם יותר גם זול יותר.",
        amountMinor: 90000,
        ceilingMinorAtCreation: 50000,
        createdById: ankoraAdmin.id,
        options: {
          create: [
            { label: "[DEMO] יום שלישי בבוקר", amountMinor: 90000, recommended: true, position: 0 },
            { label: "[DEMO] יום חמישי אחר הצהריים", amountMinor: 105000, position: 1 },
          ],
        },
      },
    });
  }

  // Portal phase 3: enough in the demo client's file that the screen
  // shows what it is for rather than four empty states. A supplier line
  // on a promise that already exists (derived, never a row of its own), a
  // recurring date opted in, and the three preferences.
  await prisma.task.update({
    where: { id: "demo-task-onboarding-kickoff" },
    data: {
      supplierName: "[DEMO] חשמלאי כהן",
      supplierExperience: "GOOD",
      supplierRecordedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.client.update({
    where: { id: clientA.id },
    data: {
      preferenceContact: "[DEMO] וואטסאפ עדיף. שיחות רק אחרי תשע.",
      preferenceMatters: "[DEMO] שהכול יהיה סגור לפני שאני שומע עליו.",
      preferenceNever: "[DEMO] שמישהו יגיע למשרד בלי תיאום מראש.",
      preferencesUpdatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      preferencesUpdatedById: ankoraAdmin.id,
    },
  });

  const existingPortalDate = await prisma.importantDate.findFirst({ where: { id: "demo-date-portal-renewal" } });
  if (!existingPortalDate) {
    await prisma.importantDate.create({
      data: {
        id: "demo-date-portal-renewal",
        clientId: clientA.id,
        title: "[DEMO] חידוש ביטוח המשרד",
        type: "renewal",
        category: "DOCUMENTS_AUTHORITIES",
        month: 3,
        day: 14,
        responsibleUserId: ankoraAdmin.id,
        additionalUserIds: [],
        extraEmailRecipients: [],
        clientVisible: true,
        nextOccurrenceAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
      },
    });
  }

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
