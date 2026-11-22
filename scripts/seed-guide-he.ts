// Hebrew demo data for the in-app guide's Hebrew screenshots (ADR 0006).
// The Hebrew twin of scripts/seed-guide-en.ts: same structure, same ids,
// same dates and counts, same randomness seed. Only the words differ.
//
// Fills an EMPTY local database with a full, Hebrew, clearly-demo world:
// the same demo accounts and password as prisma/seed.ts (so the screenshot
// script signs in the same way), five clients with a written client file
// (people, rules, processes with procedures, facts, systems, sources),
// open work for the super admin and for employee1, two weeks of time,
// hour banks with alerts, important dates, the vault, approvals waiting,
// proposals waiting for review, notifications and a client portal with
// something in every screen. Fixed data, with dates relative to now, so a
// rerun next month draws the same pictures. Never run it against anything
// but a local database: it refuses a database that already has users.
//
// HOW TO RETAKE THE HEBREW GUIDE PICTURES
//
//   1. Local Postgres (from the main checkout): node scripts/dev-db.mjs start
//   2. A fresh database, from this repo:
//        export DATABASE_URL=postgresql://ankora:ankora_dev_only@127.0.0.1:55432/ankora_guide_he
//        export DATABASE_URL_UNPOOLED=$DATABASE_URL
//        dropdb -h 127.0.0.1 -p 55432 -U ankora --if-exists --force ankora_guide_he
//        npx prisma migrate deploy        (creates the database again)
//        npx tsx scripts/seed-guide-he.ts
//      (npx prisma migrate reset --force --skip-seed does the same, where
//      Prisma lets it run.) Give the seed and the server the same VAULT_KEK,
//      or the vault entries cannot be written; a local database can use the
//      public test key from lib/vault/keys.ts. Leave RESEND_API_KEY unset:
//      the seed crosses alert thresholds, and alerts send email.
//   3. Serve a production build against it on a free port:
//        AUTH_TRUST_HOST=true DATABASE_URL=... DATABASE_URL_UNPOOLED=... VAULT_KEK=... npx next start -p 3101
//   4. Take the pictures (they land in public/guide/):
//        CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/guide-screenshots.mjs --lang=he --base=http://localhost:3101
//      Then look at every picture next to its English one in public/guide/en/.
//      Seed and take the pictures on the same day: the dates are relative
//      to the moment the seed ran.
//
// The confidentiality undertaking is signed here for every staff account,
// through the same domain function the app uses, so the screenshot script
// goes straight to the screens. The client file's reading view
// (client-file-read) is built in Hebrew by lib/app-domain/client-file-view.ts,
// so in this set it is taken like every other picture.

// The domain modules start with `import "server-only"`, which throws
// outside a React server bundle. A script is a server, so it is answered
// with an empty module before any of them load.
const NodeModule = require("node:module") as { _load: (req: string, ...rest: unknown[]) => unknown };
const originalLoad = NodeModule._load;
NodeModule._load = function (this: unknown, req: string, ...rest: unknown[]) {
  if (req === "server-only") return {};
  return originalLoad.call(this, req, ...rest);
};

import type { PrismaClient, User, Prisma, TaskStatus, TaskPriority, TaskBlocker } from "@prisma/client";

// ---------------------------------------------------------------------------
// Fixed randomness and dates relative to now
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261112);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

const NOW = new Date();
const DAY = 86_400_000;
const MIN = 60_000;

const DEMO_PASSWORD = "DemoPass!2026";

async function main() {
  const { prisma } = (await import("@/lib/prisma")) as { prisma: PrismaClient };
  const { hashPassword } = await import("@/lib/app-auth/password");
  const tz = await import("@/lib/timezone");
  const { recordAudit } = await import("@/lib/app-auth/audit");
  const { signConfidentiality } = await import("@/lib/app-domain/agreements");
  const { currentAgreement } = await import("@/lib/agreements");
  const { createManualEntry, startTimer } = await import("@/lib/app-domain/time-entries");
  const { openHourBankCycle, loadPrepaidPackage, recordHourBankAdjustment, getHourBankSnapshot } = await import("@/lib/app-domain/hour-banks");
  const { ensureDefaultAlertRules, evaluateAlertsForClient } = await import("@/lib/app-domain/alerts");
  const { addClientSource } = await import("@/lib/app-domain/client-sources");
  const { addClientContact, addClientOrganization } = await import("@/lib/app-domain/client-contacts");
  const { addSystemAccess } = await import("@/lib/app-domain/system-map");
  const { addClientFact } = await import("@/lib/app-domain/client-facts");
  const { addClientPolicy, approveClientPolicy } = await import("@/lib/app-domain/client-policies");
  const { addProcess, saveProcessVersion, approveProcessVersion, linkProcessDates } = await import("@/lib/app-domain/processes");
  const { addRequestType } = await import("@/lib/app-domain/request-types");
  const { saveNarrative } = await import("@/lib/app-domain/client-narratives");
  const { createImportantDate, updateImportantDateStatus } = await import("@/lib/app-domain/important-dates");
  const { createCredential } = await import("@/lib/app-domain/credentials");
  const { createDecision, respondToDecision } = await import("@/lib/app-domain/decisions");

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    throw new Error("This seed fills an EMPTY database. Reset it first (npx prisma migrate reset --force --skip-seed).");
  }

  const todayKey = tz.localDateKey(NOW);
  const keyAt = (offsetDays: number) => tz.addDaysToKey(todayKey, offsetDays);
  const at = (offsetDays: number, hhmm: string) => tz.localDateTimeToUtc(keyAt(offsetDays), hhmm);
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
  const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY);
  const isWorkday = (offsetDays: number) => tz.weekdayOfKey(keyAt(offsetDays)) <= 4; // Sunday to Thursday

  console.log("Seeding the Hebrew guide demo data...");

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mkUser = (data: { email: string; name: string; role: User["role"]; status?: User["status"]; canApproveExceptions?: boolean; lastSeenDaysAgo?: number }) =>
    prisma.user.create({
      data: {
        email: data.email,
        username: data.email.split("@")[0],
        name: data.name,
        role: data.role,
        status: data.status ?? "ACTIVE",
        passwordHash,
        locale: "he",
        canApproveExceptions: data.canApproveExceptions ?? false,
        lastLoginAt: data.lastSeenDaysAgo !== undefined ? daysAgo(data.lastSeenDaysAgo) : null,
        lastSeenAt: data.lastSeenDaysAgo !== undefined ? daysAgo(data.lastSeenDaysAgo) : null,
      },
    });

  const superAdmin = await mkUser({ email: "demo.superadmin@ankora.co.il", name: "יעל לוי (דמו)", role: "SUPER_ADMIN", canApproveExceptions: true, lastSeenDaysAgo: 0 });
  const admin = await mkUser({ email: "demo.admin@ankora.co.il", name: "רות אדלר (דמו)", role: "ANKORA_ADMIN", canApproveExceptions: true, lastSeenDaysAgo: 0 });
  const maya = await mkUser({ email: "demo.employee1@ankora.co.il", name: "מאיה כהן (דמו)", role: "ANKORA_EMPLOYEE", lastSeenDaysAgo: 0 });
  const itai = await mkUser({ email: "demo.employee2@ankora.co.il", name: "איתי בן דוד (דמו)", role: "ANKORA_EMPLOYEE", lastSeenDaysAgo: 1 });
  const noa = await mkUser({ email: "demo.employee3@ankora.co.il", name: "נועה כץ (דמו)", role: "ANKORA_EMPLOYEE", lastSeenDaysAgo: 2 });
  await mkUser({ email: "demo.suspended@ankora.co.il", name: "עומר שלו (דמו)", role: "ANKORA_EMPLOYEE", status: "SUSPENDED", lastSeenDaysAgo: 40 });
  await prisma.user.create({
    data: { email: "demo.invited@ankora.co.il", username: "demo.invited", name: "דנה וייס (דמו)", role: "ANKORA_EMPLOYEE", status: "INVITED", passwordHash, locale: "he" },
  });
  const clientAdmin = await mkUser({ email: "demo.clientadmin@ankora.co.il", name: "רותם גרינברג (דמו)", role: "CLIENT_USER", lastSeenDaysAgo: 1 });
  const clientViewer = await mkUser({ email: "demo.clientviewer@ankora.co.il", name: "יונתן הלוי (דמו)", role: "CLIENT_USER", lastSeenDaysAgo: 6 });

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  const mkClient = (id: string, data: Partial<Prisma.ClientUncheckedCreateInput> & { name: string }) =>
    prisma.client.create({ data: { id, status: "ACTIVE", ...data } });

  const orbit = await mkClient("demo-client-a", {
    name: "אורביט טכנולוגיות (דמו)",
    legalName: "אורביט טכנולוגיות בע\"מ (דמו)",
    primaryContact: "רותם גרינברג (דמו)",
    industry: "תוכנה לעסקים",
    accountManagerId: admin.id,
    ruleApproverIds: [superAdmin.id, admin.id],
    whatsappNumber: "052-000-0000",
    approvalCeilingMinor: 500000,
    sourceKeywords: ["אורביט", "orbit-tech"],
    preferenceContact: "קודם וואטסאפ. שיחות טלפון רק אחרי 9 בבוקר. (דמו)",
    preferenceMatters: "שכל דבר ייסגר לפני שאני שומע עליו, ושחשבוניות אף פעם לא יאחרו. (דמו)",
    preferenceNever: "אף אחד לא מגיע למשרד בלי תיאום מראש. (דמו)",
    preferencesUpdatedAt: daysAgo(3),
    preferencesUpdatedById: admin.id,
    subprocessorNotice: "COMMITTED",
    subprocessorNoticeSource: "הסכם שירות חתום, סעיף 9 (דמו)",
    subprocessorNoticeCheckedAt: daysAgo(20),
    subprocessorNoticeCheckedById: superAdmin.id,
    portalDigest: "WEEKLY",
  });
  const meridian = await mkClient("demo-client-b", {
    name: "קבוצת מרידיאן (דמו)",
    legalName: "מרידיאן אחזקות בע\"מ (דמו)",
    primaryContact: "דניאל פרץ (דמו)",
    industry: "נדל\"ן",
    accountManagerId: superAdmin.id,
    ruleApproverIds: [superAdmin.id],
    approvalCeilingMinor: 200000,
  });
  const northwind = await mkClient("demo-client-c", {
    name: "מרפאות הצפון (דמו)",
    legalName: "הצפון שירותי רפואה בע\"מ (דמו)",
    primaryContact: "ד\"ר לאה שטיין (דמו)",
    industry: "בריאות",
    accountManagerId: superAdmin.id,
    ruleApproverIds: [superAdmin.id],
  });
  const harbor = await mkClient("demo-client-d", {
    name: "חוף ואורן, עורכי דין (דמו)",
    legalName: "חוף ואורן משרד עורכי דין (דמו)",
    primaryContact: "שמעון חוף (דמו)",
    industry: "שירותים משפטיים",
    accountManagerId: admin.id,
    ruleApproverIds: [admin.id],
  });
  const sela = await mkClient("demo-client-e", {
    name: "משרד משפחת סלע (דמו)",
    primaryContact: "מרים סלע (דמו)",
    kind: "PRIVATE",
    accountManagerId: superAdmin.id,
    ruleApproverIds: [superAdmin.id],
  });
  // Ankora's own file. Found by the flag (lib/app-domain/employee-lifecycle.ts).
  // Same name as prisma/seed.ts gives it.
  const internal = await mkClient("ankora-internal", { name: "Ankora פנימי", isInternal: true });

  const clients = [orbit, meridian, northwind, harbor, sela];

  // Who works on what. Managers reach every client by role.
  const access: [User, typeof orbit][] = [
    [maya, orbit], [maya, northwind], [maya, sela], [maya, internal],
    [itai, meridian], [itai, harbor], [itai, orbit],
    [noa, northwind], [noa, harbor], [noa, meridian],
    [admin, orbit], [admin, meridian], [admin, harbor], [admin, internal],
  ];
  for (const [u, c] of access) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: c.id } });
  await prisma.clientUser.create({ data: { userId: clientAdmin.id, clientId: orbit.id, role: "ADMIN" } });
  await prisma.clientUser.create({ data: { userId: clientViewer.id, clientId: orbit.id, role: "VIEWER" } });

  for (const c of clients) {
    await recordAudit({ actorId: superAdmin.id, action: "client.create", entityType: "Client", entityId: c.id, clientId: c.id, after: { name: c.name }, ip: null, userAgent: null });
  }

  // The confidentiality undertaking, signed in the app the normal way.
  const agreement = currentAgreement("CONFIDENTIALITY");
  for (const u of [superAdmin, admin, maya, itai, noa]) {
    await signConfidentiality(u, { signedName: u.name, consent: true, version: agreement.version, ip: "127.0.0.1", userAgent: "guide-seed" });
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  const mkCategory = (id: string, name: string, sortOrder: number, description?: string, clientId?: string) =>
    prisma.category.create({ data: { id, name, sortOrder, description: description ?? null, visibility: clientId ? "CLIENT" : "GLOBAL", clientId: clientId ?? null } });

  const catMeetings = await mkCategory("demo-category-meetings", "פגישות ותיאומים", 1, "שיחות, פגישות והמשימות שיוצאות מהן");
  const catResearch = await mkCategory("demo-category-research", "בדיקות ותכנון", 2, "השוואת ספקים, אפשרויות ומחירים");
  const catBooks = await mkCategory("demo-category-bookkeeping", "הנהלת חשבונות ותשלומים", 3, "חשבוניות, ריצות תשלום והתאמות");
  const catSuppliers = await mkCategory("demo-category-suppliers", "ניהול ספקים", 4, "הזמנות, מעקב ותיאום מול ספקים");
  const catAdmin = await mkCategory("demo-category-admin", "אדמיניסטרציה ותיוק", 5, "מסמכים, טפסים ותיק הלקוח");
  const catHr = await mkCategory("demo-category-hr", "משאבי אנוש", 6, "קליטת עובדים, נתונים לשכר והטבות");
  const catOnboarding = await mkCategory("demo-category-client-a-onboarding", "קליטת אורביט", 1, "הקמת העבודה השוטפת של המשרד של אורביט אצלנו", orbit.id);
  const catTravel = await mkCategory("demo-category-travel", "נסיעות ולוגיסטיקה משפחתית", 1, "טיסות, הזמנות וענייני הבית", sela.id);
  await prisma.category.create({ data: { id: "demo-category-old", name: "פרויקט סוף שנה 2025", sortOrder: 9, active: false, visibility: "GLOBAL" } });

  // -------------------------------------------------------------------------
  // Credentials (names only on screen; the values are obviously fake)
  // -------------------------------------------------------------------------

  const vault: [typeof orbit, string, string, string][] = [
    [orbit, "חשבון בנק עסקי (דמו)", "https://bank.example", "orbit-ops-demo"],
    [orbit, "תוכנת הנהלת חשבונות (דמו)", "https://books.example", "ops@orbit.example"],
    [orbit, "Wi-Fi במשרד (דמו)", "", "Orbit-Guest"],
    [orbit, "פורטל התמיכה של נטסקיור (דמו)", "https://support.netsecure.example", "orbit"],
    [meridian, "מערכת ניהול נכסים (דמו)", "https://pms.example", "meridian-ops"],
    [northwind, "מערכת זימון תורים (דמו)", "https://clinic.example", "northwind-admin"],
    [harbor, "פורטל אגרות בית המשפט (דמו)", "https://courts.example", "harbor-pine"],
  ];
  for (const [c, name, url, username] of vault) {
    try {
      await createCredential(superAdmin, { clientId: c.id, systemName: name, url: url || null, username, password: "demo-not-a-real-password", notes: "רשומת דמו, לא פרטי כניסה אמיתיים." });
    } catch (err) {
      console.warn(`  vault entry "${name}" skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // The client file: Orbit gets the full file, the others a lighter one
  // -------------------------------------------------------------------------

  const S: Record<string, Record<string, string>> = {};
  const source = async (client: typeof orbit, key: string, kind: "TRANSCRIPT" | "CLIENT_DOCUMENT" | "EMAIL" | "PERSON" | "ANKORA_DOCUMENT", title: string, occurredDaysAgo: number, participants: string[] = []) => {
    const row = await addClientSource(superAdmin, { clientId: client.id, kind, title, weight: kind === "ANKORA_DOCUMENT" ? "SECONDARY" : "PRIMARY", occurredAt: daysAgo(occurredDaysAgo), participants });
    (S[client.id] ??= {})[key] = row.code;
    return row.code;
  };

  await source(orbit, "kickoff", "TRANSCRIPT", "פגישת פתיחה עם רותם (דמו)", 40, ["רותם גרינברג", "רות אדלר"]);
  await source(orbit, "agreement", "CLIENT_DOCUMENT", "הסכם שירות חתום (דמו)", 45);
  await source(orbit, "finance", "EMAIL", "מייל מסמנכ\"ל הכספים על אישור תשלומים (דמו)", 21, ["יונתן הלוי"]);
  await source(orbit, "weekly", "TRANSCRIPT", "סנכרון שבועי, שבוע 44 (דמו)", 9, ["רותם גרינברג", "מאיה כהן"]);
  await source(orbit, "notes", "ANKORA_DOCUMENT", "סיכומי קליטה של אנקורה (דמו)", 35);
  await source(meridian, "intro", "TRANSCRIPT", "פגישת היכרות (דמו)", 60, ["דניאל פרץ"]);
  await source(meridian, "lease", "CLIENT_DOCUMENT", "הסכם שכירות המשרד (דמו)", 55);
  await source(northwind, "intro", "TRANSCRIPT", "פגישת פתיחה עם מנהלות המרפאות (דמו)", 50, ["לאה שטיין"]);
  await source(northwind, "policy", "CLIENT_DOCUMENT", "נוהל טיפול במידע על מטופלים (דמו)", 48);
  await source(harbor, "intro", "TRANSCRIPT", "שיחה ראשונה עם שמעון חוף (דמו)", 30, ["שמעון חוף"]);
  await source(sela, "intro", "PERSON", "מרים סלע, בטלפון (דמו)", 25);
  // Who keeps each item of a client's file right: the account manager.
  const owner = (c: typeof orbit) => c.accountManagerId ?? superAdmin.id;
  const src = (c: typeof orbit, key: string, atText?: string) => [{ code: S[c.id][key], ...(atText ? { at: atText } : {}) }];

  // Story of the client.
  await saveNarrative(superAdmin, { clientId: orbit.id, kind: "OVERVIEW", body: "אורביט מפתחת תוכנה לזימון תורים למרפאות ולחדרי כושר. ארבעים עובדים, משרד אחד בתל אביב, לקוחות בישראל ובבריטניה. אנחנו מנהלים את הבק אופיס שלהם: ספקים, תשלומים, המשרד עצמו והאדמיניסטרציה של המייסדים. (דמו)", baseVersion: 0 });
  await saveNarrative(superAdmin, { clientId: orbit.id, kind: "BACKGROUND", body: "בתוך שנה הם גדלו מ-12 ל-40 עובדים, ומנהלת המשרד עזבה בקיץ. תשלומים לספקים איחרו פעמיים, וסמנכ\"ל הכספים רוצה קצב חודשי צפוי. (דמו)", baseVersion: 0 });
  await saveNarrative(superAdmin, { clientId: orbit.id, kind: "OUR_ROLE", body: "אנחנו אחראים על ריצת התשלומים לספקים, על סגירת החודש בהנהלת החשבונות ועל המשרד. רותם מחליט, ויונתן מאשר תשלומים מעל התקרה. (דמו)", baseVersion: 0 });

  // Organizations and people.
  await addClientOrganization(superAdmin, { clientId: orbit.id, ownerId: admin.id, name: "ברק ושות', רואי חשבון (דמו)", role: "רואה חשבון חיצוני", relationship: "ADVISOR", domains: ["brightbooks.example"], sources: src(orbit, "kickoff"), knowledgeStatus: "CONFIRMED" });
  await addClientOrganization(superAdmin, { clientId: orbit.id, ownerId: admin.id, name: "קלינקו שירותי ניקיון (דמו)", role: "ניקיון המשרד", relationship: "SUPPLIER", monthlyCostMinor: 420000, currency: "ILS", sources: src(orbit, "notes"), knowledgeStatus: "CONFIRMED" });
  await addClientOrganization(superAdmin, { clientId: orbit.id, ownerId: admin.id, name: "נטסקיור מחשוב (דמו)", role: "תמיכת IT ומחשבים ניידים", relationship: "PROVIDER", monthlyCostMinor: 650000, currency: "ILS", sources: src(orbit, "kickoff"), knowledgeStatus: "CONFIRMED" });

  const contact = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string) =>
    addClientContact(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...input } as never);
  const rotem = await contact(orbit, { name: "רותם גרינברג (דמו)", role: "מנכ\"ל", relationship: "CLIENT_STAFF", emails: ["rotem@orbit.example"], phones: ["052-000-0001"], isPrimary: true, isDecisionMaker: true, channelOrder: ["WHATSAPP", "EMAIL"], context: "מחליט על כל דבר חדש. מעדיף וואטסאפ קצר עם המלצה." }, "kickoff");
  const jonathan = await contact(orbit, { name: "יונתן הלוי (דמו)", role: "סמנכ\"ל כספים", relationship: "CLIENT_STAFF", emails: ["jonathan@orbit.example"], isDecisionMaker: true, context: "חותם על כל תשלום מעל 10,000 ₪." }, "finance");
  await contact(orbit, { name: "שירה בלום (דמו)", role: "מנהלת משאבי אנוש", relationship: "CLIENT_STAFF", emails: ["shira@orbit.example"], context: "עובדים חדשים ונתונים לשכר." }, "weekly");
  await contact(orbit, { name: "אלי ברק (דמו)", role: "רואה חשבון", relationship: "ADVISOR", organizationName: "ברק ושות', רואי חשבון (דמו)", emails: ["eli@brightbooks.example"] }, "kickoff");
  await contact(orbit, { name: "יפית נחום (דמו)", role: "מנהלת לקוחות", relationship: "SUPPLIER", organizationName: "קלינקו שירותי ניקיון (דמו)", phones: ["03-000-0002"] }, "notes");
  await contact(meridian, { name: "דניאל פרץ (דמו)", role: "שותף מנהל", relationship: "CLIENT_STAFF", emails: ["daniel@meridian.example"], isPrimary: true, isDecisionMaker: true }, "intro");
  await contact(northwind, { name: "ד\"ר לאה שטיין (דמו)", role: "מנהלת רפואית", relationship: "CLIENT_STAFF", emails: ["leah@northwind.example"], isPrimary: true, isDecisionMaker: true }, "intro");
  await contact(harbor, { name: "שמעון חוף (דמו)", role: "שותף מייסד", relationship: "CLIENT_STAFF", emails: ["sam@harborpine.example"], isPrimary: true, isDecisionMaker: true }, "intro");
  await contact(sela, { name: "מרים סלע (דמו)", role: "בעלת הבית", relationship: "CLIENT_STAFF", phones: ["054-000-0003"], isPrimary: true, isDecisionMaker: true }, "intro");

  // Systems (no secrets: the vault holds those).
  const system = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string) =>
    addSystemAccess(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...input } as never);
  const sysBank = await system(orbit, { systemName: "חשבון בנק עסקי (דמו)", purpose: "תשלומים לספקים ודפי חשבון", url: "https://bank.example", accountUsed: "demo.operations@ankora.co.il", ourPermission: "USER", accessStatus: "HAS_ACCESS", clientAdmin: "יונתן הלוי" }, "finance");
  const sysBooks = await system(orbit, { systemName: "תוכנת הנהלת חשבונות (דמו)", purpose: "חשבוניות, הוצאות וסגירת החודש", url: "https://books.example", accountUsed: "demo.operations@ankora.co.il", ourPermission: "ADMIN", accessStatus: "HAS_ACCESS", billingCycle: "MONTHLY", billingCostMinor: 29000, billingCurrency: "ILS" }, "kickoff");
  const sysDrive = await system(orbit, { systemName: "תיקייה משותפת (דמו)", purpose: "חוזים, חשבוניות ותיק הלקוח", url: "https://drive.example", ourPermission: "USER", accessStatus: "HAS_ACCESS" }, "kickoff");
  await system(orbit, { systemName: "פורטל השכר (דמו)", purpose: "נתונים חודשיים לשכר", ourPermission: "VIEWER", accessStatus: "PENDING", blocker: "מחכים ששירה תוסיף את המשתמש שלנו" }, "weekly");
  await system(orbit, { systemName: "בקרת כניסה למשרד (דמו)", purpose: "כרטיסי כניסה לעובדים חדשים", ourPermission: "NONE", accessStatus: "NOT_NEEDED" }, "notes");
  await system(meridian, { systemName: "מערכת ניהול נכסים (דמו)", purpose: "שוכרים ושכר דירה", ourPermission: "USER", accessStatus: "HAS_ACCESS" }, "intro");
  await system(northwind, { systemName: "מערכת זימון תורים (דמו)", purpose: "תורים ותזכורות", ourPermission: "VIEWER", accessStatus: "HAS_ACCESS" }, "intro");

  // Facts: scope, preferences, requirements, a question.
  const fact = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string) =>
    addClientFact(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...input } as never);
  await fact(orbit, { kind: "SCOPE_IN", topic: "PAYMENTS", body: "אנחנו מריצים את התשלומים לספקים פעמיים בחודש, ב-10 וב-25." }, "agreement");
  await fact(orbit, { kind: "SCOPE_IN", topic: "SUPPLIERS", body: "אנחנו מזמינים ומתאמים את כל ספקי המשרד: ניקיון, IT, קפה ותחזוקה." }, "agreement");
  await fact(orbit, { kind: "SCOPE_OUT", topic: "OTHER", body: "דיווחי מע\"מ לא באחריותנו.", referTo: "ברק ושות', רואי חשבון (אלי)" }, "agreement");
  await fact(orbit, { kind: "PREFERENCE", topic: "COMMUNICATION", body: "סיכום וואטסאפ אחד ביום חמישי אחר הצהריים, במקום הרבה הודעות קטנות." }, "weekly");
  await fact(orbit, { kind: "PREFERENCE", topic: "REPORTING", body: "הדוח החודשי נשלח לרותם וליונתן, בעברית." }, "kickoff");
  await fact(orbit, { kind: "REQUIREMENT", topic: "DOCUMENTS", body: "כל חשבונית ששולמה מתויקת בתיקייה המשותפת תחת כספים / שולם, לפי חודש." }, "finance");
  await fact(orbit, { kind: "LOCATION", topic: "OTHER", body: "המשרד בקומה 7. משלוחים נכנסים דרך רמפת הפריקה ברחוב הצדדי." }, "notes");
  await fact(orbit, { kind: "FINANCE", topic: "PAYMENTS", body: "ספקים מקבלים תשלום בשוטף + 30, אלא אם סוכם אחרת בכתב." }, "finance");
  await fact(orbit, { kind: "TEMPORARY", topic: "ADMINS", body: "עד ששירה חוזרת מחופשה, נתוני השכר עוברים לרותם.", validUntil: daysAhead(24), assigneeId: maya.id }, "weekly");
  await fact(orbit, { kind: "QUESTION", topic: "SUPPLIERS", body: "האם החוזה עם ספק הקפה מתחדש אוטומטית?", toResolve: "לשאול את רותם, או למצוא את החוזה בתיקייה המשותפת", assigneeId: maya.id }, "weekly");
  await fact(meridian, { kind: "SCOPE_IN", topic: "PAYMENTS", body: "אנחנו שולחים תזכורות על שכר דירה ורודפים במייל אחרי שוכרים שמאחרים." }, "intro");
  await fact(meridian, { kind: "PREFERENCE", topic: "COMMUNICATION", body: "דניאל קורא מיילים רק בערב. דברים דחופים בטלפון." }, "intro");
  await fact(northwind, { kind: "REQUIREMENT", topic: "DOCUMENTS", body: "שום דבר עם שם של מטופל לא יוצא ממערכות המרפאה." }, "policy");
  await fact(harbor, { kind: "SCOPE_IN", topic: "OTHER", body: "תשלום אגרות בית משפט והנסיעות של השותפים." }, "intro");
  await fact(sela, { kind: "PREFERENCE", topic: "COMMUNICATION", body: "רק שיחות טלפון, אף פעם לא הודעות קוליות." }, "intro");

  // Request types.
  await addRequestType(superAdmin, { clientId: orbit.id, ownerId: admin.id, title: "חשבונית חדשה מספק", fromWho: "ספקים, במייל", arrivesVia: "invoices@orbit.example", handling: "לבדוק מול ההזמנה, לתייק, ולהוסיף לריצת התשלומים הבאה.", knowledgeStatus: "CONFIRMED", sources: src(orbit, "finance") } as never);
  await addRequestType(superAdmin, { clientId: orbit.id, ownerId: admin.id, title: "עובד חדש מתחיל", fromWho: "שירה", arrivesVia: "וואטסאפ", handling: "מחשב נייד מנטסקיור, כרטיס כניסה, עמדת עבודה ומייל קבלת פנים ביום הראשון.", knowledgeStatus: "CONFIRMED", sources: src(orbit, "weekly") } as never);

  // Rules: active ones, a proposed one with approvers, one waiting for approval.
  const rule = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string, approve: boolean) => {
    // An approval rule says what holds until it is approved.
    const interim = ["THRESHOLD", "APPROVAL_REQUIRED"].includes(input.kind as string) && !input.interimStatement ? { interimStatement: "עד שהכלל הזה יאושר, שואלים את הלקוח לפני שמתקדמים.", interimParams: input.params } : {};
    const row = await addClientPolicy(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...interim, ...input } as never);
    if (approve) await approveClientPolicy(superAdmin, row.id);
    return row;
  };
  const ruleThreshold = await rule(orbit, {
    kind: "THRESHOLD",
    title: "תשלום מעל 10,000 ₪ דורש חתימה של יונתן",
    statement: "כל תשלום בודד מעל 10,000 ₪ נחתם על ידי יונתן לפני שהוא יוצא.",
    rationale: "באביב יצאו שני תשלומים גדולים בלי שסמנכ\"ל הכספים ידע.",
    params: { amountMinor: 1000000, currency: "ILS", appliesToTags: ["PAYMENT"] },
  }, "finance", true);
  await rule(orbit, {
    kind: "COMMUNICATION",
    title: "ספקים שומעים מאיתנו, לא מעובדי אורביט",
    statement: "הזמנות, תלונות ומשא ומתן על מחירים מול ספקי המשרד עוברים רק דרך אנקורה.",
  }, "kickoff", true);
  await rule(orbit, {
    kind: "DISCLOSURE",
    title: "לא משתפים נתוני שכר",
    statement: "נתוני שכר לא נמסרים לאף אחד מלבד רותם, יונתן ושירה, כולל ספקים ועובדים אחרים.",
  }, "kickoff", true);
  await rule(orbit, {
    kind: "TIMING",
    title: "חשבוניות נבדקות שני ימי עסקים מראש",
    statement: "חשבוניות לריצת תשלומים נבדקות לפחות שני ימי עסקים לפניה. חשבוניות שמגיעות אחר כך ממתינות לריצה הבאה.",
    params: { leadBusinessDays: 2, appliesToTags: ["INVOICE"] },
  }, "finance", false);
  await rule(orbit, {
    kind: "APPROVAL_REQUIRED",
    title: "ספק חדש מאושר על ידי רותם",
    statement: "ספק שלא עבדנו איתו קודם מאושר על ידי רותם לפני ההזמנה הראשונה.",
    interimStatement: "עד שרותם מאשר את הכלל, שואלים אותו לפני כל הזמנה ראשונה.",
    interimParams: { appliesToTags: ["SUPPLIER_NEW"] },
    params: { appliesToTags: ["SUPPLIER_NEW"] },
  }, "weekly", false);
  await rule(meridian, { kind: "COMMUNICATION", title: "פונים לשוכרים רק במייל", statement: "כל הודעה לשוכר נשלחת במייל, אף פעם לא בוואטסאפ." }, "intro", true);
  await rule(meridian, { kind: "THRESHOLD", title: "תיקון מעל 5,000 ₪ ממתין לדניאל", statement: "הצעת מחיר לתיקון מעל 5,000 ₪ ממתינה לאישור של דניאל.", params: { amountMinor: 500000, currency: "ILS", appliesToTags: ["PURCHASE"] } }, "lease", false);
  await rule(northwind, { kind: "DATA_HANDLING", title: "בלי שמות מטופלים במשימות ובהודעות", statement: "מחוץ למערכות המרפאה, מטופלים מזוהים רק לפי מספר התיק שלהם." }, "policy", true);

  // A requested exception to the payment rule, waiting for a manager.
  await prisma.policyException.create({
    data: { clientId: orbit.id, policyId: ruleThreshold.id, what: "לשלם את הזמנת המחשבים הניידים מנטסקיור (14,200 ₪) לפני שיונתן חוזר", reason: "יונתן בחו\"ל עד יום ראשון, והעובדים החדשים מתחילים ביום שני.", validUntil: daysAhead(5), requestedById: maya.id },
  });

  // -------------------------------------------------------------------------
  // Important dates (some linked to processes below)
  // -------------------------------------------------------------------------

  const mkDate = async (c: typeof orbit, input: Record<string, unknown>) =>
    createImportantDate(superAdmin, { clientId: c.id, responsibleUserId: superAdmin.id, ...input } as never);
  const dayOf = (offset: number) => Number(keyAt(offset).slice(8, 10));
  const monthOf = (offset: number) => Number(keyAt(offset).slice(5, 7));

  const datePaymentRun = await mkDate(orbit, { title: "ריצת תשלומים לספקים", type: "payment", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 25, responsibleUserId: maya.id, clientVisible: true });
  const datePaymentRun10 = await mkDate(orbit, { title: "ריצת תשלומים לספקים (אמצע החודש)", type: "payment", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 10, responsibleUserId: maya.id });
  await mkDate(orbit, { title: "חידוש ביטוח המשרד", type: "renewal", category: "DOCUMENTS_AUTHORITIES", recurrence: "ANNUAL", month: monthOf(18), day: dayOf(18), responsibleUserId: admin.id, clientVisible: true, notes: "סוכן הביטוח בשנה שעברה: מגן ביטוחים (דמו)" });
  await mkDate(orbit, { title: "מועד אחרון למימוש אופציה בשכירות המשרד", type: "contract", category: "VEHICLE_PROPERTY", recurrence: "ANNUAL", month: monthOf(41), day: dayOf(41), clientVisible: true });
  await mkDate(orbit, { title: "יום ההולדת של רותם", type: "birthday", category: "PEOPLE_FAMILY", recurrence: "ANNUAL", month: monthOf(6), day: dayOf(6), responsibleUserId: admin.id });
  const doneDate = await mkDate(orbit, { title: "בדיקת בטיחות אש שנתית", type: "inspection", category: "DOCUMENTS_AUTHORITIES", recurrence: "ANNUAL", month: monthOf(2), day: dayOf(2), responsibleUserId: maya.id, clientVisible: true });
  await updateImportantDateStatus(superAdmin, doneDate.id, "HANDLED_CURRENT");
  await mkDate(meridian, { title: "דוח מע\"מ רבעוני", type: "tax", category: "BUSINESS_FINANCE", recurrence: "ANNUAL", month: monthOf(4), day: dayOf(4), responsibleUserId: itai.id });
  await mkDate(meridian, { title: "חידוש ביטוח המבנה", type: "renewal", category: "VEHICLE_PROPERTY", recurrence: "ANNUAL", month: monthOf(12), day: dayOf(12), responsibleUserId: itai.id });
  await mkDate(northwind, { title: "חידוש רישיון רפואי", type: "licence", category: "DOCUMENTS_AUTHORITIES", recurrence: "ANNUAL", month: monthOf(9), day: dayOf(9), responsibleUserId: noa.id });
  await mkDate(harbor, { title: "דמי חבר בלשכת עורכי הדין", type: "payment", category: "BUSINESS_FINANCE", recurrence: "ANNUAL", month: monthOf(15), day: dayOf(15), responsibleUserId: itai.id });
  await mkDate(sela, { title: "חידוש דרכון למרים", type: "document", category: "HEALTH_TRAVEL", recurrence: "ONCE", month: monthOf(27), day: dayOf(27), onceDate: at(27, "09:00"), responsibleUserId: maya.id });
  const doneDate2 = await mkDate(sela, { title: "טסט שנתי לרכב", type: "vehicle", category: "VEHICLE_PROPERTY", recurrence: "ANNUAL", month: monthOf(1), day: dayOf(1), responsibleUserId: maya.id });
  await updateImportantDateStatus(superAdmin, doneDate2.id, "HANDLED_CURRENT");

  // -------------------------------------------------------------------------
  // Processes with procedures
  // -------------------------------------------------------------------------

  const step = (title: string, extra: Record<string, unknown> = {}) => ({ title, mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null, ...extra });

  const p1 = await addProcess(superAdmin, {
    clientId: orbit.id,
    title: "תשלומים לספקים",
    purpose: "כל חשבונית מאושרת של ספק משולמת בזמן, פעם אחת, ומתויקת.",
    triggerKinds: ["SCHEDULED"],
    triggerText: "מועדי ריצת התשלומים, ב-10 וב-25 לחודש",
    ownerId: maya.id,
    backupOwnerId: admin.id,
    slaText: "משולם ביום הריצה",
    requiredSystemIds: [sysBank.id, sysBooks.id],
    approverContactId: jonathan.id,
    approvalPolicyIds: [ruleThreshold.id],
    exceptionPlaybook: "חשבונית בלי הזמנה מאחוריה ממתינה, ושואלים את רותם.",
    executorUserId: maya.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(orbit, "finance"),
  } as never);
  await saveProcessVersion(superAdmin, p1.id, {
    baseVersion: 0,
    steps: [
      step("לאסוף את החשבוניות לתשלום", { offsetBusinessDays: -3, systemIds: [sysBooks.id], output: "רשימת חשבוניות לריצה הזאת" }),
      step("לבדוק חשבוניות מול הזמנות", { offsetBusinessDays: -2, mode: "ASSISTED", actionTags: ["INVOICE"], verification: "אדם קורא כל שורה שקלוד סימן" }),
      step("לאשר את רשימת התשלומים", { offsetBusinessDays: -1, actionTags: ["PAYMENT"], requiresApproval: true, amountMaxMinor: 5000000, currency: "ILS" }),
      step("לשלוח את התשלומים", { offsetBusinessDays: 0, actionTags: ["PAYMENT"], systemIds: [sysBank.id], requiresApproval: true, amountMaxMinor: 5000000, currency: "ILS" }),
      step("לשלוח אישור ליונתן", { offsetBusinessDays: 1, mode: "AUTOMATED", channel: "EMAIL", actionTags: ["CLIENT_MESSAGE"], fixedMessage: true, verification: "לבדוק את תיבת דואר יוצא למחרת בבוקר" }),
      step("התאמה מול דף הבנק", { offsetBusinessDays: 5, systemIds: [sysBank.id, sysBooks.id], output: "כל תשלום מותאם" }),
    ],
    highlights: "לעולם לא משלמים חשבונית פעמיים: קודם בודקים בתיקיית שולם.",
    outputs: "התשלומים יצאו, החשבוניות מתויקות תחת כספים / שולם.",
  });
  await approveProcessVersion(superAdmin, p1.id, 1);
  await linkProcessDates(superAdmin, p1.id, [datePaymentRun.id, datePaymentRun10.id]);

  const p2 = await addProcess(superAdmin, {
    clientId: orbit.id,
    title: "סגירת חודש בהנהלת החשבונות",
    purpose: "הספרים של החודש הקודם שלמים ונמצאים אצל רואה החשבון עד ה-7.",
    triggerKinds: ["CONTINUOUS"],
    triggerText: "כל חודש",
    ownerId: admin.id,
    backupOwnerId: maya.id,
    checkEveryDays: 30,
    checkText: "האם אלי אישר שיש לו הכול?",
    requiredSystemIds: [sysBooks.id, sysDrive.id],
    executorUserId: maya.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(orbit, "kickoff"),
  } as never);
  await saveProcessVersion(superAdmin, p2.id, {
    baseVersion: 0,
    steps: [
      step("לרשום את התנועות של החודש", { offsetBusinessDays: 0, systemIds: [sysBooks.id] }),
      step("להתאים קבלות להוצאות בכרטיס אשראי", { offsetBusinessDays: 2, mode: "ASSISTED", verification: "אדם בודק כל שורה שלא הותאמה" }),
      step("לשלוח את החודש לרואה החשבון", { offsetBusinessDays: 5, channel: "EMAIL", actionTags: ["DATA_EXPORT"], output: "מייל לאלי עם קובץ הייצוא" }),
    ],
    highlights: "לשאול את יונתן על הוצאות אשראי בלי קבלה לפני ה-3 לחודש.",
  });
  await approveProcessVersion(superAdmin, p2.id, 1);

  const p3 = await addProcess(superAdmin, {
    clientId: orbit.id,
    title: "קליטת עובד חדש",
    purpose: "לעובד חדש יש מחשב נייד, כרטיס כניסה ועמדת עבודה ביום הראשון.",
    triggerKinds: ["EVENT"],
    triggerText: "שירה מעדכנת אותנו על עובד חדש",
    ownerId: maya.id,
    executorUserId: maya.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(orbit, "weekly"),
  } as never);
  await saveProcessVersion(superAdmin, p3.id, {
    baseVersion: 0,
    steps: [
      step("להזמין מחשב נייד מנטסקיור", { offsetBusinessDays: -5, actionTags: ["PURCHASE"] }),
      step("להזמין כרטיס כניסה", { offsetBusinessDays: -3 }),
      step("להכין את עמדת העבודה", { offsetBusinessDays: -1 }),
      step("לשלוח מייל קבלת פנים", { offsetBusinessDays: 0, channel: "EMAIL", actionTags: ["CLIENT_MESSAGE"] }),
    ],
  });
  // Left as a draft on purpose: it waits on the approvals screen.

  const p4 = await addProcess(superAdmin, {
    clientId: meridian.id,
    title: "מעקב אחרי שכר דירה באיחור",
    purpose: "כל שוכר שמאחר שומע מאיתנו תוך שלושה ימי עסקים.",
    triggerKinds: ["SCHEDULED"],
    triggerText: "ה-5 בכל חודש",
    ownerId: itai.id,
    executorUserId: itai.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(meridian, "intro"),
  } as never);
  await saveProcessVersion(superAdmin, p4.id, {
    baseVersion: 0,
    steps: [step("לרשום את השוכרים שלא שילמו", { offsetBusinessDays: 0 }), step("לשלוח תזכורת במייל", { offsetBusinessDays: 1, channel: "EMAIL", actionTags: ["CLIENT_MESSAGE"] }), step("להתקשר למי שעדיין לא שילם", { offsetBusinessDays: 3, channel: "PHONE" })],
  });
  await approveProcessVersion(superAdmin, p4.id, 1);
  const dateRentDue = await mkDate(meridian, { title: "יום גביית שכר הדירה", type: "payment", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 5, responsibleUserId: itai.id });
  await linkProcessDates(superAdmin, p4.id, [dateRentDue.id]);
  await mkDate(northwind, { title: "יום הדרכה לצוות", type: "event", category: "GENERAL", recurrence: "ANNUAL", month: monthOf(-3), day: dayOf(-3) });
  await mkDate(harbor, { title: "חשבונית חודשית לחוף ואורן", type: "invoice", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: dayOf(-1) });
  await mkDate(harbor, { title: "מועד אחרון להגשה לבית המשפט, חוף נגד צפון ליין", type: "deadline", category: "DOCUMENTS_AUTHORITIES", recurrence: "ONCE", month: monthOf(1), day: dayOf(1), onceDate: at(1, "09:00") });

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  type TaskSeed = {
    id: string;
    client: typeof orbit;
    title: string;
    category?: { id: string } | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    assignee?: User | null;
    supervisor?: User | null;
    requiresApproval?: boolean;
    due?: number | null;
    description?: string;
    clientTitle?: string;
    clientRequest?: string;
    clientOutcome?: string;
    completedDaysAgo?: number;
    blocked?: { on: TaskBlocker; reason: string; sinceDaysAgo: number };
    createdDaysAgo?: number;
    supplier?: { name: string; experience: "GOOD" | "OK" | "AVOID" };
    steps?: { title: string; done?: boolean; assignee?: User; due?: number }[];
    comments?: { author: User; body: string; daysAgo: number }[];
  };

  const tasks: Record<string, string> = {};
  const mkTask = async (t: TaskSeed) => {
    const created = at(-(t.createdDaysAgo ?? 8), "09:20");
    const status = t.status ?? "OPEN";
    const row = await prisma.task.create({
      data: {
        id: t.id,
        clientId: t.client.id,
        categoryId: t.category === null ? null : (t.category ?? catMeetings).id,
        title: t.title,
        status,
        priority: t.priority ?? "NORMAL",
        assignedToId: t.assignee?.id ?? null,
        supervisorId: t.supervisor?.id ?? null,
        requiresApproval: t.requiresApproval ?? false,
        dueDate: t.due === undefined || t.due === null ? null : at(t.due, "12:00"),
        description: t.description ?? null,
        clientVisible: !!t.clientTitle,
        clientTitle: t.clientTitle ?? null,
        clientRequest: t.clientRequest ?? null,
        clientOutcome: t.clientOutcome ?? null,
        completedAt: status === "DONE" ? daysAgo(t.completedDaysAgo ?? 2) : null,
        startedAt: status === "IN_PROGRESS" || status === "PENDING_APPROVAL" || status === "DONE" ? daysAgo((t.createdDaysAgo ?? 8) - 1) : null,
        blockedOn: t.blocked?.on ?? null,
        blockedReason: t.blocked?.reason ?? null,
        blockedSince: t.blocked ? daysAgo(t.blocked.sinceDaysAgo) : null,
        supplierName: t.supplier?.name ?? null,
        supplierExperience: t.supplier?.experience ?? null,
        supplierRecordedAt: t.supplier ? daysAgo(t.completedDaysAgo ?? 2) : null,
        createdAt: created,
      },
    });
    // The board and lists order by update time; a done task was last touched when it closed.
    if (status === "DONE") await prisma.task.update({ where: { id: row.id }, data: { updatedAt: daysAgo(t.completedDaysAgo ?? 2) } });
    // Inserted directly so it carries the day the task was opened (the log
    // is append-only: a row is written once, with its time).
    await prisma.auditEvent.create({ data: { actorId: superAdmin.id, action: "task.create", entityType: "Task", entityId: row.id, clientId: row.clientId, afterJson: { title: row.title, status: row.status }, createdAt: created } });
    for (const [i, s] of (t.steps ?? []).entries()) {
      await prisma.task.create({
        data: {
          id: `${t.id}-step-${i + 1}`,
          parentId: row.id,
          clientId: t.client.id,
          categoryId: row.categoryId,
          title: s.title,
          status: s.done ? "DONE" : "OPEN",
          completedAt: s.done ? daysAgo(Math.max(1, (t.createdDaysAgo ?? 8) - 2 - i)) : null,
          assignedToId: (s.assignee ?? t.assignee)?.id ?? null,
          dueDate: s.due !== undefined ? at(s.due, "12:00") : null,
          createdAt: new Date(created.getTime() + (i + 1) * MIN),
        },
      });
    }
    for (const c of t.comments ?? []) {
      await prisma.taskComment.create({ data: { taskId: row.id, authorId: c.author.id, body: c.body, createdAt: at(-c.daysAgo, pick(["09:40", "11:15", "13:05", "15:30", "16:45"])) } });
    }
    tasks[t.id] = row.id;
    return row;
  };

  // The task the guide's task screen is shown on.
  await mkTask({
    id: "demo-task-research-competitors",
    client: orbit,
    title: "להשוות שלושה ספקי תמיכת IT",
    category: catResearch,
    status: "IN_PROGRESS",
    priority: "HIGH",
    assignee: superAdmin,
    supervisor: admin,
    due: 4,
    createdDaysAgo: 9,
    clientTitle: "משווים בשבילכם שלושה ספקי IT",
    clientRequest: "עדכנו אותנו עד יום ראשון אם קו טלפון 24/7 חשוב לכם.",
    description: [
      "שלושה ספקים להשוואה, **עד יום חמישי**:",
      "",
      "- נטסקיור מחשוב, הספק הנוכחי, חוזה `NS-2025-118`",
      "- קלאודליין, שלחו הצעת מחיר בשבוע שעבר",
      "- איירונוול, בהמלצת רותם",
      "",
      "מה שחשוב לאורביט הוא *זמן התגובה*, לא המחיר. החוזה הנוכחי נמצא ב[תיקייה המשותפת](https://example.com/contracts).",
    ].join("\n"),
    steps: [
      { title: "לאסוף את החוזה הנוכחי עם נטסקיור", done: true },
      { title: "לקבל הצעות מחיר מקלאודליין ומאיירונוול", done: true, assignee: maya },
      { title: "להשוות זמני תגובה ומחירים", due: 2 },
      { title: "לכתוב לרותם המלצה בעמוד אחד", due: 4 },
    ],
    comments: [
      { author: maya, body: "הצעת המחיר של קלאודליין בתיקייה. איירונוול ביקשו את מספר המחשבים הניידים, שלחתי 42.", daysAgo: 4 },
      { author: admin, body: "רותם אמר בסנכרון השבועי שקו ה-24/7 חשוב לו יותר מהמחיר. כדאי לפתוח עם זה.", daysAgo: 3 },
      { author: superAdmin, body: "הצעת המחיר של איירונוול הגיעה הבוקר. משווה מחר.", daysAgo: 1 },
    ],
  });
  await prisma.taskPlan.create({
    data: {
      taskId: "demo-task-research-competitors",
      version: 1,
      body: "לאסוף את שלוש ההצעות, לשים זמן תגובה, מחיר ואורך התחייבות זה לצד זה, ולשלוח לרותם המלצה בעמוד אחד עם הבחירה שלנו.",
      steps: ["לאסוף את החוזה הנוכחי עם נטסקיור", "לקבל הצעות מחיר מקלאודליין ומאיירונוול", "להשוות זמני תגובה ומחירים", "לכתוב לרותם המלצה בעמוד אחד"],
      status: "APPROVED",
      createdById: superAdmin.id,
      approvedById: admin.id,
      approvedAt: daysAgo(8),
      stepsAppliedAt: daysAgo(8),
      createdAt: daysAgo(8),
    },
  });

  await mkTask({ id: "demo-task-onboarding-kickoff", client: orbit, title: "פגישת פתיחה עם אורביט", category: catOnboarding, status: "DONE", assignee: admin, completedDaysAgo: 30, createdDaysAgo: 40, clientTitle: "פגישת הפתיחה שלכם", clientOutcome: "נפגשנו, מיפינו את כל מה שרץ במשרד שלכם, ויצאנו עם תוכנית לשלושת החודשים הראשונים." });
  await mkTask({ id: "demo-task-waiting-on-client", client: orbit, title: "ביקור טכנאי מזגנים", category: catSuppliers, status: "IN_PROGRESS", assignee: maya, due: 3, clientTitle: "לבחור מועד לביקור הטכנאי", blocked: { on: "CLIENT", reason: "נשלחו שלושה מועדים, מחכים שרותם יבחר", sinceDaysAgo: 2 }, createdDaysAgo: 6 });
  await mkTask({ id: "demo-task-orbit-cleaning", client: orbit, title: "החלפת ספק הניקיון", category: catSuppliers, status: "IN_PROGRESS", priority: "HIGH", assignee: maya, supervisor: superAdmin, requiresApproval: true, due: 6, clientTitle: "בוחרים ספק ניקיון חדש", createdDaysAgo: 12,
    steps: [{ title: "לבקש הצעות מחיר משלושה ספקים", done: true }, { title: "סיור במשרד עם שני המובילים", done: true }, { title: "לשלוח לרותם את ההמלצה", due: 2 }, { title: "לתת לקלינקו הודעה מוקדמת של חודש", due: 6 }],
    comments: [{ author: maya, body: "ספארקל אופיס יכולים להתחיל ב-1 לחודש, וזולים ב-12%.", daysAgo: 2 }] });
  await mkTask({ id: "demo-task-orbit-lease", client: orbit, title: "חידוש שכירות המשרד", category: catAdmin, status: "IN_PROGRESS", assignee: admin, due: 20, clientTitle: "מחדשים את שכירות המשרד שלכם", createdDaysAgo: 15, blocked: { on: "SUPPLIER", reason: "עורך הדין של בעל הנכס עובר על השינויים שלנו", sinceDaysAgo: 5 } });
  await mkTask({ id: "demo-task-orbit-payroll", client: orbit, title: "נתונים לשכר נובמבר", category: catHr, status: "OPEN", assignee: maya, due: 8, createdDaysAgo: 3 });
  await mkTask({ id: "demo-task-orbit-laptops", client: orbit, title: "להזמין מחשבים ניידים לשני עובדים חדשים", category: catSuppliers, status: "PENDING_APPROVAL", assignee: maya, supervisor: superAdmin, requiresApproval: true, due: 1, priority: "URGENT", createdDaysAgo: 5, clientTitle: "מחשבים ניידים לשני העובדים החדשים", clientOutcome: "שני מחשבים ניידים הוזמנו ויגיעו ביום ראשון בבוקר.",
    steps: [{ title: "לקבל את המפרט משירה", done: true }, { title: "להזמין מנטסקיור", done: true }] });
  await mkTask({ id: "demo-task-orbit-rent", client: orbit, title: "לשלם את שכר הדירה של המשרד לאוקטובר", category: catBooks, status: "DONE", assignee: maya, completedDaysAgo: 4, createdDaysAgo: 10, clientTitle: "שכר דירה למשרד, אוקטובר", clientOutcome: "שולם, והקבלה בתיק שלכם." });
  await mkTask({ id: "demo-task-orbit-coffee", client: orbit, title: "מכונת קפה חדשה", category: catSuppliers, status: "DONE", assignee: itai, completedDaysAgo: 6, createdDaysAgo: 14, clientTitle: "מכונת קפה חדשה למטבח", clientOutcome: "הותקנה ביום שלישי, כולל שנת שירות.", supplier: { name: "קפה על הדרך (דמו)", experience: "GOOD" } });
  await mkTask({ id: "demo-task-orbit-insurance", client: orbit, title: "לאסוף הצעות לחידוש הביטוח", category: catAdmin, status: "DONE", assignee: admin, completedDaysAgo: 1, createdDaysAgo: 12, clientTitle: "הצעות מחיר לחידוש ביטוח המשרד", clientOutcome: "נאספו שלוש הצעות. מגן ביטוחים נשארת המשתלמת ביותר." });
  await mkTask({ id: "demo-task-orbit-quarterly", client: orbit, title: "להכין את דוח ההוצאות הרבעוני", category: catBooks, status: "OPEN", assignee: superAdmin, due: 13, createdDaysAgo: 2, clientTitle: "דוח ההוצאות הרבעוני שלכם" });

  await mkTask({ id: "demo-task-meridian-weekly", client: meridian, title: "סנכרון שבועי עם דניאל", category: catMeetings, status: "OPEN", assignee: superAdmin, due: 2, createdDaysAgo: 7 });
  await mkTask({ id: "demo-task-meridian-tenants", client: meridian, title: "מעקב אחרי שלושה שוכרים שמאחרים", category: catBooks, status: "IN_PROGRESS", priority: "HIGH", assignee: itai, supervisor: superAdmin, due: 1, createdDaysAgo: 6,
    steps: [{ title: "תזכורות במייל", done: true }, { title: "להתקשר לשניים שלא ענו", due: 1 }] });
  await mkTask({ id: "demo-task-supervised-fixture", client: meridian, title: "להחליף את ספק הניקיון", category: catSuppliers, status: "PENDING_APPROVAL", assignee: itai, supervisor: superAdmin, requiresApproval: true, due: 0, createdDaysAgo: 11, description: "השוואת מחירים מול שני ספקים נוספים, ואז אישור לפני חתימה." });
  await mkTask({ id: "demo-task-board-fixture", client: meridian, title: "לחדש את ביטוח המשרד", category: catAdmin, status: "OPEN", assignee: superAdmin, due: 9, createdDaysAgo: 4 });
  await mkTask({ id: "demo-task-board-supervised", client: meridian, title: "לאשר את התקציב הרבעוני", category: catBooks, status: "OPEN", assignee: itai, supervisor: superAdmin, requiresApproval: true, due: 11, createdDaysAgo: 4 });
  await mkTask({ id: "demo-task-meridian-repair", client: meridian, title: "הצעות מחיר לתיקון הגג בבניין B", category: catSuppliers, status: "IN_PROGRESS", assignee: superAdmin, due: 5, createdDaysAgo: 9, blocked: { on: "SUPPLIER", reason: "הגגן השני מגיע ביום ראשון למדוד", sinceDaysAgo: 3 } });

  await mkTask({ id: "demo-task-northwind-licences", client: northwind, title: "לאסוף העתקי רישיונות של הצוות", category: catAdmin, status: "IN_PROGRESS", assignee: maya, due: 7, createdDaysAgo: 10, steps: [{ title: "רופאים", done: true }, { title: "אחיות", done: false }, { title: "קבלה", done: false }] });
  await mkTask({ id: "demo-task-northwind-schedule", client: northwind, title: "להגדיר תזכורות לתורים", category: catResearch, status: "OPEN", priority: "HIGH", assignee: superAdmin, due: 3, createdDaysAgo: 3, blocked: { on: "INTERNAL", reason: "מחכים לסיכום של נועה מהביקור במרפאה", sinceDaysAgo: 1 } });
  await mkTask({ id: "demo-task-northwind-supplies", client: northwind, title: "הזמנה חודשית של ציוד רפואי", category: catSuppliers, status: "DONE", assignee: noa, completedDaysAgo: 3, createdDaysAgo: 8 });

  await mkTask({ id: "demo-task-harbor-travel", client: harbor, title: "להזמין לשמעון נסיעה לדיון בלונדון", category: catSuppliers, status: "IN_PROGRESS", assignee: itai, due: 6, createdDaysAgo: 5 });
  await mkTask({ id: "demo-task-harbor-fees", client: harbor, title: "לשלם את אגרות בית המשפט של החודש", category: catBooks, status: "OPEN", assignee: superAdmin, supervisor: admin, due: 1, priority: "URGENT", createdDaysAgo: 1 });

  await mkTask({ id: "demo-task-sela-passport", client: sela, title: "תור לחידוש דרכון", category: catTravel, status: "OPEN", assignee: maya, due: 10, createdDaysAgo: 4 });
  await mkTask({ id: "demo-task-sela-holiday", client: sela, title: "לתכנן את החופשה המשפחתית בדצמבר", category: catTravel, status: "IN_PROGRESS", assignee: maya, supervisor: superAdmin, due: 14, createdDaysAgo: 7,
    steps: [{ title: "שלוש אפשרויות למלון", done: true }, { title: "טיסות", due: 5 }, { title: "השכרת רכב", due: 9 }] });
  await prisma.taskPlan.create({
    data: {
      taskId: "demo-task-sela-holiday",
      version: 1,
      body: "קודם להזמין טיסות כל עוד המחירים מחזיקים, אחר כך את המלון שמרים תבחר, ואז רכב. לשלוח לה הודעה אחת עם שלושתם לאישור.",
      steps: ["להזמין טיסות", "להזמין את המלון", "להשכיר רכב", "לשלוח למרים את הסיכום"],
      status: "DRAFT",
      createdById: maya.id,
      createdAt: daysAgo(1),
    },
  });

  await mkTask({ id: "demo-task-calendar-fixture", client: meridian, title: "להזמין טכנאי מזגנים", category: catSuppliers, status: "OPEN", assignee: itai, createdDaysAgo: 2 });
  await mkTask({ id: "demo-task-screen-fixture", client: meridian, title: "תיאום מול ועד הבית", category: catMeetings, status: "OPEN", assignee: itai, due: 12, createdDaysAgo: 2 });
  await mkTask({ id: "demo-task-old-proposal", client: meridian, title: "הצעת מחיר ישנה", category: catResearch, status: "ARCHIVED", createdDaysAgo: 60 });
  await mkTask({ id: "demo-task-meridian-rent-summary", client: meridian, title: "לשלוח לדניאל את סיכום שכר הדירה לאוקטובר", category: catBooks, status: "DONE", assignee: superAdmin, due: -2, completedDaysAgo: 2, createdDaysAgo: 9 });
  await mkTask({ id: "demo-task-northwind-signoff", client: northwind, title: "לאשר את הזמנת הציוד", category: catSuppliers, status: "DONE", assignee: superAdmin, due: -3, completedDaysAgo: 3, createdDaysAgo: 6 });
  await mkTask({ id: "demo-task-orbit-insurance-compare", client: orbit, title: "לשלוח לרותם את השוואת הביטוחים", category: catAdmin, status: "IN_PROGRESS", assignee: superAdmin, due: -1, createdDaysAgo: 5 });
  await mkTask({ id: "demo-task-harbor-call", client: harbor, title: "להתקשר לשמעון לגבי מועדי הדיון בלונדון", category: catMeetings, status: "OPEN", assignee: superAdmin, due: 0, createdDaysAgo: 2 });
  await mkTask({ id: "demo-task-internal-guide", client: internal, title: "לעדכן את רשימת התיוג לקליטת עובדים", category: catAdmin, status: "OPEN", assignee: superAdmin, due: 15, createdDaysAgo: 6 });

  // -------------------------------------------------------------------------
  // Hour banks and time
  // -------------------------------------------------------------------------

  await prisma.billingPolicy.create({ data: { clientId: orbit.id, minimumMinutes: 15, incrementMinutes: 15, roundingMode: "CEIL", aggregationScope: "PER_ENTRY" } });
  await prisma.billingPolicy.create({ data: { clientId: meridian.id, minimumMinutes: 0, incrementMinutes: 5, roundingMode: "NEAREST", aggregationScope: "PER_ENTRY" } });

  for (const c of clients) await ensureDefaultAlertRules(superAdmin, c.id);
  // The defaults name real people at Ankora; a picture for the guide names demo ones.
  await prisma.alertRule.updateMany({ data: { recipientsAnkora: ["demo.admin@ankora.co.il", "demo.superadmin@ankora.co.il"] } });

  const monthStartKey = (key: string) => `${key.slice(0, 8)}01`;
  const prevMonthKey = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  };
  const nextMonthKey = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  };
  const thisMonth = monthStartKey(todayKey);
  const lastMonth = prevMonthKey(thisMonth);
  const twoMonthsAgo = prevMonthKey(lastMonth);
  const utc = (key: string) => tz.localDateTimeToUtc(key, "00:00");

  // The time itself: two weeks for several people, plus some older time so
  // the earlier cycles are not empty.
  const plan: { user: User; client: typeof orbit; categories: { id: string }[]; taskIds: (string | null)[]; notes: string[] }[] = [
    { user: maya, client: orbit, categories: [catSuppliers, catBooks, catHr, catOnboarding], taskIds: ["demo-task-orbit-cleaning", "demo-task-waiting-on-client", "demo-task-orbit-laptops", null], notes: ["שיחות עם ספקים", "חשבוניות לריצת התשלומים", "נתונים לשכר", "סיור במשרד"] },
    { user: maya, client: northwind, categories: [catAdmin], taskIds: ["demo-task-northwind-licences", null], notes: ["העתקי רישיונות", "תיוק"] },
    { user: maya, client: sela, categories: [catTravel], taskIds: ["demo-task-sela-holiday", null], notes: ["אפשרויות למלון", "שיחות עם מרים"] },
    { user: itai, client: meridian, categories: [catBooks, catSuppliers], taskIds: ["demo-task-meridian-tenants", "demo-task-supervised-fixture", null], notes: ["תזכורות לשוכרים", "הצעות מחיר מספקים", "כרטסת שכר דירה"] },
    { user: itai, client: harbor, categories: [catSuppliers], taskIds: ["demo-task-harbor-travel", null], notes: ["טיסות ומלון", "טפסי אגרות בית משפט"] },
    { user: noa, client: northwind, categories: [catSuppliers, catAdmin], taskIds: ["demo-task-northwind-supplies", null], notes: ["הזמנת ציוד", "סיכום ביקור במרפאה"] },
    { user: admin, client: orbit, categories: [catMeetings, catAdmin], taskIds: ["demo-task-orbit-lease", "demo-task-orbit-insurance", null], notes: ["סנכרון שבועי עם רותם", "עבודה על חוזה השכירות", "הצעות מחיר לביטוח"] },
    { user: superAdmin, client: orbit, categories: [catResearch], taskIds: ["demo-task-research-competitors"], notes: ["השוואת ספקי IT"] },
    { user: superAdmin, client: meridian, categories: [catMeetings, catSuppliers], taskIds: ["demo-task-meridian-weekly", "demo-task-meridian-repair"], notes: ["סנכרון שבועי", "הצעות מחיר לגג"] },
    { user: superAdmin, client: northwind, categories: [catResearch], taskIds: ["demo-task-northwind-schedule"], notes: ["אפשרויות לתזכורות"] },
  ];

  // Which people work on which day, and from what hour.
  const entriesFor = (dayOffset: number) => {
    const out: { user: User; client: typeof orbit; categoryId: string; taskId: string | null; note: string; start: string; minutes: number }[] = [];
    const byUser = new Map<string, typeof plan>();
    for (const p of plan) byUser.set(p.user.id, [...(byUser.get(p.user.id) ?? []), p]);
    for (const [userId, lines] of byUser) {
      // Maya (employee1) is the one the timer screens are shown as: a full week.
      const full = userId === maya.id;
      if (!full && rand() < 0.2) continue; // a day off, or a day on internal work
      let minuteOfDay = 9 * 60 + Math.floor(rand() * 8) * 15;
      const count = (full ? 3 : 1) + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const line = pick(lines);
        const minutes = [30, 45, 45, 60, 60, 90][Math.floor(rand() * 6)];
        const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
        const mm = String(minuteOfDay % 60).padStart(2, "0");
        out.push({ user: line.user, client: line.client, categoryId: pick(line.categories).id, taskId: pick(line.taskIds), note: pick(line.notes), start: `${hh}:${mm}`, minutes });
        minuteOfDay += minutes + 15 * Math.floor(rand() * 3);
      }
    }
    return out;
  };

  const timer = new Set<string>();
  const logDay = async (dayOffset: number, onlyClients?: Set<string>) => {
    if (!isWorkday(dayOffset)) return;
    for (const e of entriesFor(dayOffset)) {
      if (onlyClients && !onlyClients.has(e.client.id)) continue;
      const startAt = at(dayOffset, e.start);
      const endAt = new Date(startAt.getTime() + e.minutes * MIN);
      if (endAt.getTime() > NOW.getTime() - 100 * MIN) continue; // nothing in the future, room for the running timers
      try {
        const entry = await createManualEntry(superAdmin, e.user.id, {
          clientId: e.client.id,
          categoryId: e.categoryId,
          taskId: e.taskId,
          startAt,
          endAt,
          note: e.note,
          backdateReason: dayOffset < 0 ? "נרשם מהסיכום של אותו יום (דמו)" : null,
          closedBankOverride: { reason: "היסטוריית דמו (דמו)" },
        });
        // Most time is recorded with the timer.
        if (rand() < 0.8) {
          await prisma.timeEntry.update({ where: { id: entry.id }, data: { source: "TIMER", isManual: false } });
          timer.add(entry.id);
        }
      } catch (err) {
        console.warn(`  skipped an entry on ${keyAt(dayOffset)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // Orbit: a monthly cycle. Last month's closed, this month's open.
  await openHourBankCycle(superAdmin, orbit.id, { cycleStart: utc(lastMonth), cycleEnd: utc(thisMonth), purchasedMinutes: 40 * 60, rolloverMode: "NONE" });
  // Northwind and Harbor: monthly cycles too.
  await openHourBankCycle(superAdmin, northwind.id, { cycleStart: utc(lastMonth), cycleEnd: utc(thisMonth), purchasedMinutes: 25 * 60, rolloverMode: "NONE" });
  await openHourBankCycle(superAdmin, harbor.id, { cycleStart: utc(lastMonth), cycleEnd: utc(thisMonth), purchasedMinutes: 15 * 60, rolloverMode: "NONE" });
  // Meridian and Sela: prepaid packages, Meridian nearly used up.
  await loadPrepaidPackage(superAdmin, meridian.id, { startAt: utc(twoMonthsAgo), purchasedMinutes: 30 * 60 });
  await loadPrepaidPackage(superAdmin, sela.id, { startAt: utc(lastMonth), purchasedMinutes: 20 * 60 });

  // Older time: last month (and a little before), so closed cycles and
  // reports have history.
  for (let d = -42; d <= -15; d++) {
    if (keyAt(d) < twoMonthsAgo) continue;
    await logDay(d);
  }

  // The current cycles start on the 1st of this month.
  await openHourBankCycle(superAdmin, orbit.id, { cycleStart: utc(thisMonth), cycleEnd: utc(nextMonthKey(thisMonth)), purchasedMinutes: 40 * 60, rolloverMode: "NONE" });
  await openHourBankCycle(superAdmin, northwind.id, { cycleStart: utc(thisMonth), cycleEnd: utc(nextMonthKey(thisMonth)), purchasedMinutes: 25 * 60, rolloverMode: "NONE" });
  await openHourBankCycle(superAdmin, harbor.id, { cycleStart: utc(thisMonth), cycleEnd: utc(nextMonthKey(thisMonth)), purchasedMinutes: 15 * 60, rolloverMode: "NONE" });

  // The last two weeks.
  for (let d = -14; d <= 0; d++) await logDay(d);

  const orbitBank = await prisma.hourBank.findFirst({ where: { clientId: orbit.id, cycleStart: utc(thisMonth) } });
  if (orbitBank) {
    await recordHourBankAdjustment(superAdmin, orbit.id, { hourBankId: orbitBank.id, minutes: 30, reason: "זיכוי על הפגישה שהתארכה בשבוע שעבר (דמו)" }).catch((err: unknown) => console.warn("  adjustment skipped:", err instanceof Error ? err.message : err));
  }

  // Running timers: Maya on Orbit, Itai on Meridian.
  const running1 = await startTimer(maya, { clientId: orbit.id, categoryId: catSuppliers.id, taskId: "demo-task-orbit-cleaning", note: "שיחה עם ספארקל אופיס על מועד ההתחלה" });
  await prisma.timeEntry.update({ where: { id: running1.id }, data: { startAt: new Date(NOW.getTime() - 87 * MIN) } });
  const running2 = await startTimer(itai, { clientId: meridian.id, categoryId: catBooks.id, taskId: "demo-task-meridian-tenants", note: "שיחות לשני השוכרים שלא ענו" });
  await prisma.timeEntry.update({ where: { id: running2.id }, data: { startAt: new Date(NOW.getTime() - 34 * MIN) } });

  // Size every bank from the time actually logged in it, so each one tells
  // its story: Orbit over last month and nearing this month's end, Meridian's
  // package almost used, the rest on pace. Then the alerts are worked out
  // once, from the final numbers (each entry above re-evaluated them on the
  // way, against banks that were still the wrong size).
  const usage: Record<string, number[]> = {
    [orbit.id]: [1.12, 0.82],
    [northwind.id]: [0.9, 0.55],
    [harbor.id]: [0.7, 0.45],
    [meridian.id]: [0.86],
    [sela.id]: [0.5],
  };
  for (const [clientId, ratios] of Object.entries(usage)) {
    const banks = await prisma.hourBank.findMany({ where: { clientId, deletedAt: null }, orderBy: { cycleStart: "asc" } });
    for (const [i, bank] of banks.entries()) {
      const { utilization } = await getHourBankSnapshot(bank);
      const ratio = ratios[i] ?? 0.6;
      const purchasedMinutes = Math.max(300, Math.round(utilization.consumedMinutes / ratio / 300) * 300); // whole 5-hour steps, as sold
      const ended = bank.cycleEnd.getTime() <= NOW.getTime();
      await prisma.hourBank.update({ where: { id: bank.id }, data: { purchasedMinutes, rolloverInMinutes: 0, ...(ended ? { status: "CLOSED", recalculatedAt: null } : {}) } });
    }
  }
  await prisma.emailDelivery.deleteMany({ where: { alertEventId: { not: null } } });
  await prisma.alertEvent.deleteMany({});
  for (const c of clients) await evaluateAlertsForClient(c.id);

  // -------------------------------------------------------------------------
  // Decisions for the client
  // -------------------------------------------------------------------------

  await createDecision(admin, {
    clientId: orbit.id,
    taskId: "demo-task-waiting-on-client",
    question: "איזה מועד מתאים לטכנאי המזגנים?",
    background: "יש שני חלונות פנויים השבוע. המוקדם גם זול יותר, כי הוא חלק מהמסלול שלהם.",
    amountMinor: 90000,
    dueAt: daysAhead(2),
    options: [
      { label: "יום שלישי בבוקר, 8:00 עד 10:00", amountMinor: 90000, recommended: true },
      { label: "יום חמישי אחר הצהריים, 14:00 עד 16:00", amountMinor: 105000 },
    ],
  });
  await createDecision(admin, {
    clientId: orbit.id,
    taskId: "demo-task-orbit-cleaning",
    question: "לאיזה ספק ניקיון לעבור?",
    background: "סיירנו במשרד עם שניהם. ספארקל אופיס זולים יותר ויכולים להתחיל ב-1 לחודש; לפרושיין יש ניסיון טוב יותר עם משרדים בגודל שלכם.",
    amountMinor: 380000,
    dueAt: daysAhead(5),
    options: [
      { label: "ספארקל אופיס, 3,700 ₪ לחודש", detail: "מתחילים ב-1 לחודש, 3 פעמים בשבוע", amountMinor: 370000, recommended: true },
      { label: "פרושיין, 4,100 ₪ לחודש", detail: "מתחילים באמצע החודש, ניקיון קל כל יום", amountMinor: 410000 },
      { label: "להישאר בינתיים עם קלינקו", amountMinor: 420000 },
    ],
  });
  const answered = await createDecision(admin, {
    clientId: orbit.id,
    taskId: "demo-task-orbit-coffee",
    question: "איזו מכונת קפה להזמין?",
    background: "שתיהן כוללות שנת שירות.",
    amountMinor: 450000,
    options: [
      { label: "על הדרך פרו, 4,500 ₪", amountMinor: 450000, recommended: true },
      { label: "מכונת קפסולות בסיסית, 1,200 ₪", amountMinor: 120000 },
    ],
  });
  const answeredRow = await prisma.decision.findUnique({ where: { id: answered.id }, include: { options: true } });
  if (answeredRow) await respondToDecision(clientAdmin, answeredRow.id, answeredRow.options[0].id);
  await prisma.decision.update({ where: { id: answered.id }, data: { createdAt: daysAgo(12) } });

  // -------------------------------------------------------------------------
  // Portal: documents, monthly summary, report schedules and runs
  // -------------------------------------------------------------------------

  // The English seed builds the drive file id from the title; a Hebrew title
  // would collapse to dashes, so the same ids are passed explicitly.
  const doc = (title: string, slug: string, kind: "CONTRACT" | "INVOICE" | "CERTIFICATE" | "POLICY" | "OTHER", daysOld: number, taskId?: string) =>
    prisma.clientDocument.create({ data: { clientId: orbit.id, title, kind, driveFileId: `demo-drive-file-${slug}`, mimeType: "application/pdf", sizeBytes: 180_000 + Math.floor(rand() * 400_000), clientVisible: true, uploadedById: admin.id, taskId: taskId ?? null, createdAt: daysAgo(daysOld) } });
  await doc("הסכם שירות עם אנקורה (דמו).pdf", "service-agreement-with-ankora-demo-pdf", "CONTRACT", 45);
  await doc("פוליסת ביטוח המשרד 2026 (דמו).pdf", "office-insurance-policy-2026-demo-pdf", "CERTIFICATE", 30);
  await doc("קבלה על שכר דירה לאוקטובר (דמו).pdf", "october-rent-receipt-demo-pdf", "INVOICE", 4, "demo-task-orbit-rent");
  await doc("תעודת אחריות למכונת הקפה (דמו).pdf", "coffee-machine-warranty-demo-pdf", "OTHER", 6, "demo-task-orbit-coffee");
  await doc("אישור בטיחות אש (דמו).pdf", "fire-safety-certificate-demo-pdf", "CERTIFICATE", 2);

  await prisma.portalSummary.create({
    data: {
      clientId: orbit.id,
      periodStart: utc(lastMonth),
      periodEnd: utc(thisMonth),
      draft: "בחודש שעבר סגרנו את השלב הראשון בתוכנית הפתיחה: ריצות התשלומים יוצאות עכשיו ב-10 וב-25, מכונת הקפה הותקנה, והצעות המחיר לביטוח נאספו. בחודש הבא: ספק הניקיון החדש וחידוש השכירות.",
      status: "APPROVED",
      sourceTaskIds: ["demo-task-onboarding-kickoff", "demo-task-orbit-coffee"],
      sourceDecisionIds: [answered.id],
      approvedById: admin.id,
      approvedAt: daysAgo(10),
      generatedAt: daysAgo(11),
    },
  });
  await prisma.portalSummary.create({
    data: {
      clientId: orbit.id,
      periodStart: utc(thisMonth),
      periodEnd: utc(nextMonthKey(thisMonth)),
      draft: "עד עכשיו החודש: שכר הדירה לאוקטובר שולם, הצעות המחיר לביטוח הגיעו, והוזמנו שני מחשבים ניידים לעובדים החדשים. ממתין לכם: מועד לביקור הטכנאי.",
      status: "DRAFT",
      sourceTaskIds: ["demo-task-orbit-rent", "demo-task-orbit-insurance"],
      sourceDecisionIds: [],
      generatedAt: daysAgo(0),
    },
  });

  const schedule = await prisma.reportSchedule.create({ data: { id: "demo-report-schedule-orbit", clientId: orbit.id, reportType: "MONTHLY_DETAILED", frequency: "MONTHLY", recipients: ["demo.clientadmin@ankora.co.il", "jonathan@orbit.example"], dayOfMonth: 1, lastSentAt: utc(thisMonth) } });
  await prisma.reportSchedule.create({ data: { clientId: orbit.id, reportType: "WEEKLY_ACTIVITY", frequency: "WEEKLY", recipients: ["demo.clientadmin@ankora.co.il"], dayOfWeek: 4, hour: 16 } });
  await prisma.reportSchedule.create({ data: { clientId: meridian.id, reportType: "HOUR_BANK_STATUS", frequency: "MONTHLY", recipients: ["daniel@meridian.example"], dayOfMonth: 1 } });
  await prisma.reportSchedule.create({ data: { clientId: northwind.id, reportType: "HOURS_BY_CATEGORY", frequency: "MONTHLY", recipients: ["leah@northwind.example"], dayOfMonth: 2, enabled: false } });
  for (const [start, end] of [[twoMonthsAgo, lastMonth], [lastMonth, thisMonth]]) {
    await prisma.reportRun.create({ data: { scheduleId: schedule.id, periodStart: utc(start), periodEnd: utc(end), snapshotJson: {}, createdAt: utc(end) } });
  }

  // -------------------------------------------------------------------------
  // Knowledge proposals waiting for review
  // -------------------------------------------------------------------------

  const batch = await prisma.knowledgeBatch.create({
    data: { clientId: meridian.id, sourceId: (await prisma.clientSource.findFirst({ where: { clientId: meridian.id, code: S[meridian.id].intro } }))!.id, via: "MCP", note: "מפגישת ההיכרות עם דניאל", createdById: admin.id, createdAt: daysAgo(1) },
  });
  const proposals: { target: "FACT" | "CONTACT" | "POLICY" | "SYSTEM"; payload: Record<string, unknown>; reason: string; quote?: string; confidence: string }[] = [
    { target: "FACT", payload: { kind: "PREFERENCE", topic: "COMMUNICATION", body: "דניאל רוצה מייל סיכום אחד ביום שישי, לא עדכונים יומיים.", sources: [{ code: S[meridian.id].intro, at: "04:12" }] }, reason: "נאמר פעמיים בפגישה", quote: "פשוט תשלחו לי מייל אחד ביום שישי עם הכול.", confidence: "HIGH" },
    { target: "FACT", payload: { kind: "SCOPE_IN", topic: "SUPPLIERS", body: "אנחנו מתאמים את כל התיקונים בשני הבניינים, עד סף האישור.", sources: [{ code: S[meridian.id].intro, at: "11:40" }] }, reason: "היקף שסוכם", confidence: "HIGH" },
    { target: "CONTACT", payload: { name: "אבי רוזן (דמו)", role: "אחזקת מבנים", relationship: "SUPPLIER", phones: ["050-000-0004"], sources: [{ code: S[meridian.id].intro, at: "15:02" }] }, reason: "האיש שמתקשרים אליו לתיקונים", confidence: "MEDIUM" },
    { target: "SYSTEM", payload: { systemName: "פורטל שוכרים (דמו)", purpose: "שוכרים מדווחים כאן על תקלות", ourPermission: "VIEWER", accessStatus: "PENDING", sources: [{ code: S[meridian.id].intro, at: "18:30" }] }, reason: "צריך גישה כדי לראות תקלות פתוחות", confidence: "MEDIUM" },
    { target: "POLICY", payload: { kind: "TIMING", title: "תזכורות על שכר דירה באיחור יוצאות ב-5 לחודש", statement: "שוכר שלא שילם עד ה-5 לחודש מקבל תזכורת באותו יום.", sources: [{ code: S[meridian.id].intro, at: "21:15" }] }, reason: "הכלל של דניאל לשוכרים", confidence: "HIGH" },
    { target: "FACT", payload: { kind: "QUESTION", topic: "PAYMENTS", body: "מי חותם על תשלומים לתיקונים כשדניאל בחו\"ל?", toResolve: "לשאול את דניאל בשיחה הבאה", sources: [{ code: S[meridian.id].intro, at: "25:48" }] }, reason: "לא נענה בפגישה", confidence: "LOW" },
  ];
  for (const p of proposals) {
    await prisma.knowledgeProposal.create({ data: { batchId: batch.id, clientId: meridian.id, target: p.target, payload: p.payload as Prisma.InputJsonValue, reason: p.reason, quote: p.quote ?? null, confidence: p.confidence, createdAt: daysAgo(1) } });
  }
  const batch2 = await prisma.knowledgeBatch.create({
    data: { clientId: orbit.id, sourceId: (await prisma.clientSource.findFirst({ where: { clientId: orbit.id, code: S[orbit.id].weekly } }))!.id, via: "MCP", note: "מהסנכרון השבועי, שבוע 44", createdById: maya.id, createdAt: daysAgo(0) },
  });
  for (const p of [
    { target: "FACT", payload: { kind: "TEMPORARY", topic: "OTHER", body: "המטבח סגור לשיפוץ עד סוף החודש.", validUntilEvent: "השיפוץ הסתיים", sources: [{ code: S[orbit.id].weekly, at: "02:30" }] }, reason: "משפיע על משלוחים", confidence: "HIGH" },
    { target: "FACT", payload: { kind: "REQUIREMENT", topic: "REPORTING", body: "דוח ההוצאות הרבעוני כולל הוצאות אשראי לפי עובד.", sources: [{ code: S[orbit.id].weekly, at: "09:05" }] }, reason: "יונתן ביקש", confidence: "MEDIUM" },
  ]) {
    await prisma.knowledgeProposal.create({ data: { batchId: batch2.id, clientId: orbit.id, target: p.target as "FACT", payload: p.payload as Prisma.InputJsonValue, reason: p.reason, confidence: p.confidence } });
  }

  // The extraction guide: one approved version, and a proposed second.
  await prisma.extractionGuide.create({
    data: {
      version: 1,
      body: "- מחלצים רק מה שנאמר במפורש.\n- כל פריט מציין את המקור שלו ואת הדקה בהקלטה.\n- אף פעם לא מעתיקים סיסמאות או מספרי כרטיסי אשראי.\n- כלל צריך את המילים של הלקוח עצמו, לא את הסיכום שלנו.",
      note: "גרסה ראשונה",
      state: "APPROVED",
      createdById: admin.id,
      createdAt: daysAgo(23),
      decidedById: superAdmin.id,
      decidedAt: daysAgo(22),
    },
  });
  await prisma.extractionGuide.create({
    data: {
      version: 2,
      body: "- מחלצים רק מה שנאמר במפורש.\n- כל פריט מציין את המקור שלו ואת הדקה בהקלטה.\n- אף פעם לא מעתיקים סיסמאות או מספרי כרטיסי אשראי.\n- כלל צריך את המילים של הלקוח עצמו, לא את הסיכום שלנו.\n- שם שנשמע פעם אחת הוא שאלה, לא איש קשר.",
      note: "שם שנשמע פעם אחת הופך לשאלה",
      state: "DRAFT",
      createdById: admin.id,
      createdAt: daysAgo(1),
    },
  });

  // -------------------------------------------------------------------------
  // Integrations
  // -------------------------------------------------------------------------

  await prisma.mcpAccessToken.create({
    data: { userId: superAdmin.id, label: "המקבוק של יעל (דמו)", tokenHash: "demo-grant-not-a-real-token-hash-0000000000000000000000000000", tokenVersion: 0, expiresAt: daysAhead(365) },
  });

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  const notify = (user: User, type: string, title: string, body: string, hoursAgo: number, read = false, entity?: { type: string; id: string }) =>
    prisma.notification.create({ data: { userId: user.id, type, title, body, entityType: entity?.type ?? null, entityId: entity?.id ?? null, createdAt: new Date(NOW.getTime() - hoursAgo * 60 * MIN), readAt: read ? new Date(NOW.getTime() - (hoursAgo - 1) * 60 * MIN) : null } });
  for (const u of [superAdmin, maya]) {
    await notify(u, "task_assigned", "משימה חדשה בשבילך", "לשלם את אגרות בית המשפט של החודש · חוף ואורן, עורכי דין (דמו)", 2, false, { type: "Task", id: "demo-task-harbor-fees" });
    await notify(u, "task_supervisor", "הוגדרת כמפקחת על משימה", "החלפת ספק הניקיון · אורביט טכנולוגיות (דמו)", 5, false, { type: "Task", id: "demo-task-orbit-cleaning" });
    await notify(u, "decision_answered", "רותם ענה על החלטה", "איזו מכונת קפה להזמין? על הדרך פרו, 4,500 ₪", 26, false);
    await notify(u, "hour_bank_alert", "החבילה של קבוצת מרידיאן כמעט נוצלה", "נוצלו יותר מ-80% מהשעות ששולמו מראש. זה הזמן לדבר על החבילה הבאה.", 30, true);
    await notify(u, "important_date", "מתקרב: חידוש ביטוח המשרד", "אורביט טכנולוגיות (דמו), בעוד 18 ימים", 50, true);
    await notify(u, "long_running_timer", "טיימר רץ כבר הרבה זמן", "הטיימר של אורביט טכנולוגיות רץ כבר 9 שעות. כדאי לבדוק אם צריך לעצור אותו.", 70, true);
  }

  // A few more audit rows of the kind people look for.
  const invited = await prisma.user.findUniqueOrThrow({ where: { email: "demo.invited@ankora.co.il" } });
  const suspended = await prisma.user.findUniqueOrThrow({ where: { email: "demo.suspended@ankora.co.il" } });
  await prisma.auditEvent.create({ data: { actorId: superAdmin.id, action: "user.invite", entityType: "User", entityId: invited.id, afterJson: { email: invited.email, role: invited.role }, createdAt: at(-1, "10:05") } });
  await prisma.auditEvent.create({ data: { actorId: superAdmin.id, action: "user.role_status_change", entityType: "User", entityId: suspended.id, beforeJson: { status: "ACTIVE" }, afterJson: { status: "SUSPENDED" }, createdAt: at(-30, "17:20") } });

  // -------------------------------------------------------------------------
  // Finishing touches
  // -------------------------------------------------------------------------

  // Dates the client sees in the portal's file.
  await prisma.importantDate.updateMany({ where: { clientId: orbit.id, title: { in: ["ריצת תשלומים לספקים", "חידוש ביטוח המשרד", "מועד אחרון למימוש אופציה בשכירות המשרד", "בדיקת בטיחות אש שנתית"] } }, data: { clientVisible: true } });
  await prisma.user.update({ where: { id: superAdmin.id }, data: { whatsappNumber: "050-000-0005" } });

  // R14 words why an item backed only by Ankora's own notes is uncertain,
  // and stores that sentence in Hebrew. The English seed rewrites it in
  // English at this point; the Hebrew set keeps the domain's own sentence.

  // Everything above was written a moment ago. Spread it back over the
  // weeks it would really have taken, so dates on screen read naturally:
  // the client file and the vault three to five weeks ago, signatures two
  // months ago. The activity log is append-only and keeps its own times.
  const spread = (col: string, base: number) => `"${col}" - interval '1 day' * (${base} + (('x' || substr(md5(id), 1, 6))::bit(24)::int % 14))`;
  const fileTables: [string, string[]][] = [
    ["client_contacts", ["createdAt", "verifiedAt"]],
    ["client_organizations", ["createdAt", "verifiedAt"]],
    ["client_facts", ["createdAt", "verifiedAt"]],
    ["system_access", ["createdAt", "verifiedAt"]],
    ["request_types", ["createdAt", "verifiedAt"]],
    ["client_policies", ["createdAt", "verifiedAt", "approvedAt"]],
    ["processes", ["createdAt", "verifiedAt", "lastReviewedAt"]],
    ["client_narratives", ["createdAt"]],
    ["client_credentials", ["createdAt", "secretUpdatedAt"]],
  ];
  for (const [table, cols] of fileTables) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET ${cols.map((c) => `"${c}" = ${spread(c, 20)}`).join(", ")} WHERE "clientId" <> 'ankora-internal' AND "createdAt" > now() - interval '1 hour'`);
  }
  await prisma.$executeRawUnsafe(`UPDATE "process_versions" SET "createdAt" = "createdAt" - interval '24 days', "approvedAt" = "approvedAt" - interval '23 days' WHERE "status" = 'APPROVED'`);
  await prisma.$executeRawUnsafe(`UPDATE "employee_agreements" SET "signedAt" = "signedAt" - interval '60 days', "createdAt" = "createdAt" - interval '60 days'`);

  // The "Claude usage" screen: stuck, at risk, calm, calm.
  const { seedClaudeUsage } = await import("./seed-guide-claude-usage");
  await seedClaudeUsage(prisma, [maya, itai, noa, admin], NOW);

  console.log("Done. Demo accounts (all share the password below):");
  console.log(`  password: ${DEMO_PASSWORD}`);
  for (const u of [superAdmin, admin, maya, itai, noa, clientAdmin]) console.log(`  ${u.email} (${u.role})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
