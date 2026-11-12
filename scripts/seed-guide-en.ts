// English demo data for the in-app guide's English screenshots (ADR 0006).
//
// Fills an EMPTY local database with a full, English, clearly-demo world:
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
// HOW TO RETAKE THE ENGLISH GUIDE PICTURES
//
//   1. Local Postgres (from the main checkout): node scripts/dev-db.mjs start
//   2. A fresh database, from this repo:
//        export DATABASE_URL=postgresql://ankora:ankora_dev_only@127.0.0.1:55432/ankora_guide_en
//        export DATABASE_URL_UNPOOLED=$DATABASE_URL
//        dropdb -h 127.0.0.1 -p 55432 -U ankora --if-exists --force ankora_guide_en
//        npx prisma migrate deploy        (creates the database again)
//        npx tsx scripts/seed-guide-en.ts
//      (npx prisma migrate reset --force --skip-seed does the same, where
//      Prisma lets it run.) Give the seed and the server the same VAULT_KEK,
//      or the vault entries cannot be written; a local database can use the
//      public test key from lib/vault/keys.ts. Leave RESEND_API_KEY unset:
//      the seed crosses alert thresholds, and alerts send email.
//   3. Serve a production build against it on a free port:
//        AUTH_TRUST_HOST=true DATABASE_URL=... DATABASE_URL_UNPOOLED=... VAULT_KEK=... npx next start -p 3101
//   4. Take the pictures (they land in public/guide/en/):
//        CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/guide-screenshots.mjs --lang=en --base=http://localhost:3101
//      Then look at every picture next to its Hebrew one in public/guide/.
//      Seed and take the pictures on the same day: the dates are relative
//      to the moment the seed ran.
//
// The confidentiality undertaking is signed here for every staff account,
// through the same domain function the app uses, so the screenshot script
// goes straight to the screens. Known gap: the client file's reading view
// (client-file-read) is built in Hebrew by lib/app-domain/client-file-view.ts
// whatever the reader's language (it is also what Claude and the client
// file document read), so the English guide keeps the Hebrew picture until
// that view is translated, and the script skips it with --lang=en.

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

  console.log("Seeding the English guide demo data...");

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
        locale: "en",
        canApproveExceptions: data.canApproveExceptions ?? false,
        lastLoginAt: data.lastSeenDaysAgo !== undefined ? daysAgo(data.lastSeenDaysAgo) : null,
        lastSeenAt: data.lastSeenDaysAgo !== undefined ? daysAgo(data.lastSeenDaysAgo) : null,
      },
    });

  const superAdmin = await mkUser({ email: "demo.superadmin@ankora.co.il", name: "Alex Morgan (demo)", role: "SUPER_ADMIN", canApproveExceptions: true, lastSeenDaysAgo: 0 });
  const admin = await mkUser({ email: "demo.admin@ankora.co.il", name: "Ruth Adler (demo)", role: "ANKORA_ADMIN", canApproveExceptions: true, lastSeenDaysAgo: 0 });
  const maya = await mkUser({ email: "demo.employee1@ankora.co.il", name: "Maya Cohen (demo)", role: "ANKORA_EMPLOYEE", lastSeenDaysAgo: 0 });
  const itai = await mkUser({ email: "demo.employee2@ankora.co.il", name: "Itai Ben David (demo)", role: "ANKORA_EMPLOYEE", lastSeenDaysAgo: 1 });
  const noa = await mkUser({ email: "demo.employee3@ankora.co.il", name: "Noa Katz (demo)", role: "ANKORA_EMPLOYEE", lastSeenDaysAgo: 2 });
  await mkUser({ email: "demo.suspended@ankora.co.il", name: "Omer Shalev (demo)", role: "ANKORA_EMPLOYEE", status: "SUSPENDED", lastSeenDaysAgo: 40 });
  await prisma.user.create({
    data: { email: "demo.invited@ankora.co.il", username: "demo.invited", name: "Dana Weiss (demo)", role: "ANKORA_EMPLOYEE", status: "INVITED", passwordHash, locale: "en" },
  });
  const clientAdmin = await mkUser({ email: "demo.clientadmin@ankora.co.il", name: "Rotem Green (demo)", role: "CLIENT_USER", lastSeenDaysAgo: 1 });
  const clientViewer = await mkUser({ email: "demo.clientviewer@ankora.co.il", name: "Jonathan Hale (demo)", role: "CLIENT_USER", lastSeenDaysAgo: 6 });

  // -------------------------------------------------------------------------
  // Clients
  // -------------------------------------------------------------------------

  const mkClient = (id: string, data: Partial<Prisma.ClientUncheckedCreateInput> & { name: string }) =>
    prisma.client.create({ data: { id, status: "ACTIVE", ...data } });

  const orbit = await mkClient("demo-client-a", {
    name: "Orbit Technologies (demo)",
    legalName: "Orbit Technologies Ltd (demo)",
    primaryContact: "Rotem Green (demo)",
    industry: "B2B software",
    accountManagerId: admin.id,
    ruleApproverIds: [superAdmin.id, admin.id],
    whatsappNumber: "052-000-0000",
    approvalCeilingMinor: 500000,
    sourceKeywords: ["Orbit", "orbit-tech"],
    preferenceContact: "WhatsApp first. Calls only after 9 in the morning. (demo)",
    preferenceMatters: "That everything is closed before I hear about it, and that invoices are never late. (demo)",
    preferenceNever: "Nobody comes to the office without coordinating first. (demo)",
    preferencesUpdatedAt: daysAgo(3),
    preferencesUpdatedById: admin.id,
    subprocessorNotice: "COMMITTED",
    subprocessorNoticeSource: "Signed service agreement, section 9 (demo)",
    subprocessorNoticeCheckedAt: daysAgo(20),
    subprocessorNoticeCheckedById: superAdmin.id,
    portalDigest: "WEEKLY",
  });
  const meridian = await mkClient("demo-client-b", {
    name: "Meridian Group (demo)",
    legalName: "Meridian Holdings Ltd (demo)",
    primaryContact: "Daniel Price (demo)",
    industry: "Real estate",
    accountManagerId: superAdmin.id,
    ruleApproverIds: [superAdmin.id],
    approvalCeilingMinor: 200000,
  });
  const northwind = await mkClient("demo-client-c", {
    name: "Northwind Clinics (demo)",
    legalName: "Northwind Medical Services Ltd (demo)",
    primaryContact: "Dr. Leah Stone (demo)",
    industry: "Healthcare",
    accountManagerId: superAdmin.id,
    ruleApproverIds: [superAdmin.id],
  });
  const harbor = await mkClient("demo-client-d", {
    name: "Harbor & Pine Law (demo)",
    legalName: "Harbor & Pine Law Offices (demo)",
    primaryContact: "Sam Harbor (demo)",
    industry: "Legal services",
    accountManagerId: admin.id,
    ruleApproverIds: [admin.id],
  });
  const sela = await mkClient("demo-client-e", {
    name: "Sela Family Office (demo)",
    primaryContact: "Miriam Sela (demo)",
    kind: "PRIVATE",
    accountManagerId: superAdmin.id,
    ruleApproverIds: [superAdmin.id],
  });
  // Ankora's own file. Found by the flag (lib/app-domain/employee-lifecycle.ts).
  const internal = await mkClient("ankora-internal", { name: "Ankora internal", isInternal: true });

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

  const catMeetings = await mkCategory("demo-category-meetings", "Meetings and coordination", 1, "Calls, meetings and the follow-up that comes out of them");
  const catResearch = await mkCategory("demo-category-research", "Research and planning", 2, "Comparing suppliers, options and prices");
  const catBooks = await mkCategory("demo-category-bookkeeping", "Bookkeeping and payments", 3, "Invoices, payment runs and reconciliation");
  const catSuppliers = await mkCategory("demo-category-suppliers", "Supplier management", 4, "Ordering, chasing and coordinating suppliers");
  const catAdmin = await mkCategory("demo-category-admin", "Admin and filing", 5, "Documents, forms and the client file");
  const catHr = await mkCategory("demo-category-hr", "People and HR", 6, "Onboarding, payroll inputs and benefits");
  const catOnboarding = await mkCategory("demo-category-client-a-onboarding", "Orbit onboarding", 1, "Getting Orbit's office running with us", orbit.id);
  const catTravel = await mkCategory("demo-category-travel", "Travel and family logistics", 1, "Trips, bookings and household matters", sela.id);
  await prisma.category.create({ data: { id: "demo-category-old", name: "Year-end project 2025", sortOrder: 9, active: false, visibility: "GLOBAL" } });

  // -------------------------------------------------------------------------
  // Credentials (names only on screen; the values are obviously fake)
  // -------------------------------------------------------------------------

  const vault: [typeof orbit, string, string, string][] = [
    [orbit, "Business bank account (demo)", "https://bank.example", "orbit-ops-demo"],
    [orbit, "Bookkeeping software (demo)", "https://books.example", "ops@orbit.example"],
    [orbit, "Office Wi-Fi (demo)", "", "Orbit-Guest"],
    [orbit, "NetSecure support portal (demo)", "https://support.netsecure.example", "orbit"],
    [meridian, "Property management system (demo)", "https://pms.example", "meridian-ops"],
    [northwind, "Clinic scheduling (demo)", "https://clinic.example", "northwind-admin"],
    [harbor, "Court fees portal (demo)", "https://courts.example", "harbor-pine"],
  ];
  for (const [c, name, url, username] of vault) {
    try {
      await createCredential(superAdmin, { clientId: c.id, systemName: name, url: url || null, username, password: "demo-not-a-real-password", notes: "Demo entry, not a real login." });
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

  await source(orbit, "kickoff", "TRANSCRIPT", "Kickoff meeting with Rotem (demo)", 40, ["Rotem Green", "Ruth Adler"]);
  await source(orbit, "agreement", "CLIENT_DOCUMENT", "Signed service agreement (demo)", 45);
  await source(orbit, "finance", "EMAIL", "Email from the CFO about payment approvals (demo)", 21, ["Jonathan Hale"]);
  await source(orbit, "weekly", "TRANSCRIPT", "Weekly sync, week 44 (demo)", 9, ["Rotem Green", "Maya Cohen"]);
  await source(orbit, "notes", "ANKORA_DOCUMENT", "Ankora onboarding notes (demo)", 35);
  await source(meridian, "intro", "TRANSCRIPT", "Introduction meeting (demo)", 60, ["Daniel Price"]);
  await source(meridian, "lease", "CLIENT_DOCUMENT", "Office lease agreement (demo)", 55);
  await source(northwind, "intro", "TRANSCRIPT", "Kickoff with the clinic managers (demo)", 50, ["Leah Stone"]);
  await source(northwind, "policy", "CLIENT_DOCUMENT", "Patient data handling policy (demo)", 48);
  await source(harbor, "intro", "TRANSCRIPT", "First call with Sam Harbor (demo)", 30, ["Sam Harbor"]);
  await source(sela, "intro", "PERSON", "Miriam Sela, by phone (demo)", 25);
  // Who keeps each item of a client's file right: the account manager.
  const owner = (c: typeof orbit) => c.accountManagerId ?? superAdmin.id;
  const src = (c: typeof orbit, key: string, atText?: string) => [{ code: S[c.id][key], ...(atText ? { at: atText } : {}) }];

  // Story of the client.
  await saveNarrative(superAdmin, { clientId: orbit.id, kind: "OVERVIEW", body: "Orbit builds scheduling software for clinics and gyms. Forty people, one office in Tel Aviv, customers in Israel and the UK. We run their back office: suppliers, payments, the office itself and the founders' admin. (demo)", baseVersion: 0 });
  await saveNarrative(superAdmin, { clientId: orbit.id, kind: "BACKGROUND", body: "They grew from 12 to 40 people in a year and the office manager left in the summer. Payments were late twice, and the CFO wants a predictable monthly rhythm. (demo)", baseVersion: 0 });
  await saveNarrative(superAdmin, { clientId: orbit.id, kind: "OUR_ROLE", body: "We own the supplier payment run, the bookkeeping close and the office. Rotem decides, Jonathan approves payments above the ceiling. (demo)", baseVersion: 0 });

  // Organizations and people.
  await addClientOrganization(superAdmin, { clientId: orbit.id, ownerId: admin.id, name: "Bright Books CPA (demo)", role: "External accountant", relationship: "ADVISOR", domains: ["brightbooks.example"], sources: src(orbit, "kickoff"), knowledgeStatus: "CONFIRMED" });
  await addClientOrganization(superAdmin, { clientId: orbit.id, ownerId: admin.id, name: "CleanCo Facilities (demo)", role: "Office cleaning", relationship: "SUPPLIER", monthlyCostMinor: 420000, currency: "ILS", sources: src(orbit, "notes"), knowledgeStatus: "CONFIRMED" });
  await addClientOrganization(superAdmin, { clientId: orbit.id, ownerId: admin.id, name: "NetSecure IT (demo)", role: "IT support and laptops", relationship: "PROVIDER", monthlyCostMinor: 650000, currency: "ILS", sources: src(orbit, "kickoff"), knowledgeStatus: "CONFIRMED" });

  const contact = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string) =>
    addClientContact(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...input } as never);
  const rotem = await contact(orbit, { name: "Rotem Green (demo)", role: "CEO", relationship: "CLIENT_STAFF", emails: ["rotem@orbit.example"], phones: ["052-000-0001"], isPrimary: true, isDecisionMaker: true, channelOrder: ["WHATSAPP", "EMAIL"], context: "Decides on anything new. Prefers a short WhatsApp with a recommendation." }, "kickoff");
  const jonathan = await contact(orbit, { name: "Jonathan Hale (demo)", role: "CFO", relationship: "CLIENT_STAFF", emails: ["jonathan@orbit.example"], isDecisionMaker: true, context: "Signs every payment above 10,000 ILS." }, "finance");
  await contact(orbit, { name: "Shira Bloom (demo)", role: "Head of People", relationship: "CLIENT_STAFF", emails: ["shira@orbit.example"], context: "New hires and payroll inputs." }, "weekly");
  await contact(orbit, { name: "Eli Brightman (demo)", role: "Accountant", relationship: "ADVISOR", organizationName: "Bright Books CPA (demo)", emails: ["eli@brightbooks.example"] }, "kickoff");
  await contact(orbit, { name: "Yael Norton (demo)", role: "Account manager", relationship: "SUPPLIER", organizationName: "CleanCo Facilities (demo)", phones: ["03-000-0002"] }, "notes");
  await contact(meridian, { name: "Daniel Price (demo)", role: "Managing partner", relationship: "CLIENT_STAFF", emails: ["daniel@meridian.example"], isPrimary: true, isDecisionMaker: true }, "intro");
  await contact(northwind, { name: "Dr. Leah Stone (demo)", role: "Medical director", relationship: "CLIENT_STAFF", emails: ["leah@northwind.example"], isPrimary: true, isDecisionMaker: true }, "intro");
  await contact(harbor, { name: "Sam Harbor (demo)", role: "Founding partner", relationship: "CLIENT_STAFF", emails: ["sam@harborpine.example"], isPrimary: true, isDecisionMaker: true }, "intro");
  await contact(sela, { name: "Miriam Sela (demo)", role: "Principal", relationship: "CLIENT_STAFF", phones: ["054-000-0003"], isPrimary: true, isDecisionMaker: true }, "intro");

  // Systems (no secrets: the vault holds those).
  const system = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string) =>
    addSystemAccess(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...input } as never);
  const sysBank = await system(orbit, { systemName: "Business bank account (demo)", purpose: "Supplier payments and statements", url: "https://bank.example", accountUsed: "ops@ankora.co.il", ourPermission: "USER", accessStatus: "HAS_ACCESS", clientAdmin: "Jonathan Hale" }, "finance");
  const sysBooks = await system(orbit, { systemName: "Bookkeeping software (demo)", purpose: "Invoices, expenses and the monthly close", url: "https://books.example", accountUsed: "ops@ankora.co.il", ourPermission: "ADMIN", accessStatus: "HAS_ACCESS", billingCycle: "MONTHLY", billingCostMinor: 29000, billingCurrency: "ILS" }, "kickoff");
  const sysDrive = await system(orbit, { systemName: "Shared drive (demo)", purpose: "Contracts, invoices and the client file", url: "https://drive.example", ourPermission: "USER", accessStatus: "HAS_ACCESS" }, "kickoff");
  await system(orbit, { systemName: "Payroll portal (demo)", purpose: "Monthly payroll inputs", ourPermission: "VIEWER", accessStatus: "PENDING", blocker: "Waiting for Shira to add our user" }, "weekly");
  await system(orbit, { systemName: "Office access control (demo)", purpose: "Door cards for new employees", ourPermission: "NONE", accessStatus: "NOT_NEEDED" }, "notes");
  await system(meridian, { systemName: "Property management system (demo)", purpose: "Tenants and rent", ourPermission: "USER", accessStatus: "HAS_ACCESS" }, "intro");
  await system(northwind, { systemName: "Clinic scheduling (demo)", purpose: "Appointments and reminders", ourPermission: "VIEWER", accessStatus: "HAS_ACCESS" }, "intro");

  // Facts: scope, preferences, requirements, a question.
  const fact = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string) =>
    addClientFact(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...input } as never);
  await fact(orbit, { kind: "SCOPE_IN", topic: "PAYMENTS", body: "We run the supplier payment run twice a month, on the 10th and the 25th." }, "agreement");
  await fact(orbit, { kind: "SCOPE_IN", topic: "SUPPLIERS", body: "We order and coordinate every office supplier: cleaning, IT, coffee, maintenance." }, "agreement");
  await fact(orbit, { kind: "SCOPE_OUT", topic: "OTHER", body: "Sales tax filings are not ours.", referTo: "Bright Books CPA (Eli)" }, "agreement");
  await fact(orbit, { kind: "PREFERENCE", topic: "COMMUNICATION", body: "One WhatsApp summary on Thursday afternoon instead of many small messages." }, "weekly");
  await fact(orbit, { kind: "PREFERENCE", topic: "REPORTING", body: "The monthly report goes to Rotem and Jonathan, in English." }, "kickoff");
  await fact(orbit, { kind: "REQUIREMENT", topic: "DOCUMENTS", body: "Every paid invoice is filed in the shared drive under Finance / Paid, by month." }, "finance");
  await fact(orbit, { kind: "LOCATION", topic: "OTHER", body: "The office is on the 7th floor. Deliveries go through the loading entrance on the side street." }, "notes");
  await fact(orbit, { kind: "FINANCE", topic: "PAYMENTS", body: "Suppliers are paid net 30 from the end of the month, unless agreed otherwise in writing." }, "finance");
  await fact(orbit, { kind: "TEMPORARY", topic: "ADMINS", body: "Until Shira is back from leave, payroll inputs go to Rotem.", validUntil: daysAhead(24), assigneeId: maya.id }, "weekly");
  await fact(orbit, { kind: "QUESTION", topic: "SUPPLIERS", body: "Does the coffee supplier contract renew automatically?", toResolve: "Ask Rotem, or find the contract in the shared drive", assigneeId: maya.id }, "weekly");
  await fact(meridian, { kind: "SCOPE_IN", topic: "PAYMENTS", body: "We collect rent reminders and chase late tenants by email." }, "intro");
  await fact(meridian, { kind: "PREFERENCE", topic: "COMMUNICATION", body: "Daniel reads email in the evening only. Urgent matters by phone." }, "intro");
  await fact(northwind, { kind: "REQUIREMENT", topic: "DOCUMENTS", body: "Nothing with a patient's name leaves the clinic systems." }, "policy");
  await fact(harbor, { kind: "SCOPE_IN", topic: "OTHER", body: "Court fee payments and the partners' travel." }, "intro");
  await fact(sela, { kind: "PREFERENCE", topic: "COMMUNICATION", body: "Phone calls only, never voice messages." }, "intro");

  // Request types.
  await addRequestType(superAdmin, { clientId: orbit.id, ownerId: admin.id, title: "New supplier invoice", fromWho: "Suppliers, by email", arrivesVia: "invoices@orbit.example", handling: "Check it against the order, file it, and add it to the next payment run.", knowledgeStatus: "CONFIRMED", sources: src(orbit, "finance") } as never);
  await addRequestType(superAdmin, { clientId: orbit.id, ownerId: admin.id, title: "New employee starting", fromWho: "Shira", arrivesVia: "WhatsApp", handling: "Laptop from NetSecure, door card, a desk, and a welcome email on day one.", knowledgeStatus: "CONFIRMED", sources: src(orbit, "weekly") } as never);

  // Rules: active ones, a proposed one with approvers, one waiting for approval.
  const rule = async (c: typeof orbit, input: Record<string, unknown>, sourceKey: string, approve: boolean) => {
    // An approval rule says what holds until it is approved.
    const interim = ["THRESHOLD", "APPROVAL_REQUIRED"].includes(input.kind as string) && !input.interimStatement ? { interimStatement: "Until this rule is approved, ask the client before going ahead.", interimParams: input.params } : {};
    const row = await addClientPolicy(superAdmin, { clientId: c.id, knowledgeStatus: "CONFIRMED", sources: src(c, sourceKey), ownerId: owner(c), ...interim, ...input } as never);
    if (approve) await approveClientPolicy(superAdmin, row.id);
    return row;
  };
  const ruleThreshold = await rule(orbit, {
    kind: "THRESHOLD",
    title: "Payments above 10,000 ILS need Jonathan's signature",
    statement: "Any single payment above 10,000 ILS is signed by Jonathan before it is sent.",
    rationale: "Two large payments went out without the CFO knowing in the spring.",
    params: { amountMinor: 1000000, currency: "ILS", appliesToTags: ["PAYMENT"] },
  }, "finance", true);
  await rule(orbit, {
    kind: "COMMUNICATION",
    title: "Suppliers hear from us, not from Orbit staff",
    statement: "Orders, complaints and price talks with office suppliers go through Ankora only.",
  }, "kickoff", true);
  await rule(orbit, {
    kind: "DISCLOSURE",
    title: "Salaries are never shared",
    statement: "Salary figures are not shared with anyone outside Rotem, Jonathan and Shira, including suppliers and other staff.",
  }, "kickoff", true);
  await rule(orbit, {
    kind: "TIMING",
    title: "Invoices are checked two business days ahead",
    statement: "Invoices for a payment run are checked at least two business days before it. Later ones wait for the next run.",
    params: { leadBusinessDays: 2, appliesToTags: ["INVOICE"] },
  }, "finance", false);
  await rule(orbit, {
    kind: "APPROVAL_REQUIRED",
    title: "New suppliers are approved by Rotem",
    statement: "A supplier we have not used before is approved by Rotem before the first order.",
    interimStatement: "Until Rotem confirms the rule, ask her before any first order.",
    interimParams: { appliesToTags: ["SUPPLIER_NEW"] },
    params: { appliesToTags: ["SUPPLIER_NEW"] },
  }, "weekly", false);
  await rule(meridian, { kind: "COMMUNICATION", title: "Tenants are written to by email only", statement: "Every message to a tenant goes by email, never WhatsApp." }, "intro", true);
  await rule(meridian, { kind: "THRESHOLD", title: "Repairs above 5,000 ILS wait for Daniel", statement: "A repair quote above 5,000 ILS waits for Daniel's yes.", params: { amountMinor: 500000, currency: "ILS", appliesToTags: ["PURCHASE"] } }, "lease", false);
  await rule(northwind, { kind: "DATA_HANDLING", title: "No patient names in tasks or messages", statement: "Patients are referred to by their file number only, everywhere outside the clinic systems." }, "policy", true);

  // A requested exception to the payment rule, waiting for a manager.
  await prisma.policyException.create({
    data: { clientId: orbit.id, policyId: ruleThreshold.id, what: "Pay the NetSecure laptop order (14,200 ILS) before Jonathan is back", reason: "Jonathan is abroad until Sunday and the new hires start Monday.", validUntil: daysAhead(5), requestedById: maya.id },
  });

  // -------------------------------------------------------------------------
  // Important dates (some linked to processes below)
  // -------------------------------------------------------------------------

  const mkDate = async (c: typeof orbit, input: Record<string, unknown>) =>
    createImportantDate(superAdmin, { clientId: c.id, responsibleUserId: superAdmin.id, ...input } as never);
  const dayOf = (offset: number) => Number(keyAt(offset).slice(8, 10));
  const monthOf = (offset: number) => Number(keyAt(offset).slice(5, 7));

  const datePaymentRun = await mkDate(orbit, { title: "Supplier payment run", type: "payment", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 25, responsibleUserId: maya.id, clientVisible: true });
  const datePaymentRun10 = await mkDate(orbit, { title: "Supplier payment run (mid month)", type: "payment", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 10, responsibleUserId: maya.id });
  await mkDate(orbit, { title: "Office insurance renewal", type: "renewal", category: "DOCUMENTS_AUTHORITIES", recurrence: "ANNUAL", month: monthOf(18), day: dayOf(18), responsibleUserId: admin.id, clientVisible: true, notes: "Last year's broker: Shield Insurance (demo)" });
  await mkDate(orbit, { title: "Office lease option deadline", type: "contract", category: "VEHICLE_PROPERTY", recurrence: "ANNUAL", month: monthOf(41), day: dayOf(41), clientVisible: true });
  await mkDate(orbit, { title: "Rotem's birthday", type: "birthday", category: "PEOPLE_FAMILY", recurrence: "ANNUAL", month: monthOf(6), day: dayOf(6), responsibleUserId: admin.id });
  const doneDate = await mkDate(orbit, { title: "Annual fire safety inspection", type: "inspection", category: "DOCUMENTS_AUTHORITIES", recurrence: "ANNUAL", month: monthOf(2), day: dayOf(2), responsibleUserId: maya.id, clientVisible: true });
  await updateImportantDateStatus(superAdmin, doneDate.id, "HANDLED_CURRENT");
  await mkDate(meridian, { title: "Quarterly VAT report", type: "tax", category: "BUSINESS_FINANCE", recurrence: "ANNUAL", month: monthOf(4), day: dayOf(4), responsibleUserId: itai.id });
  await mkDate(meridian, { title: "Building insurance renewal", type: "renewal", category: "VEHICLE_PROPERTY", recurrence: "ANNUAL", month: monthOf(12), day: dayOf(12), responsibleUserId: itai.id });
  await mkDate(northwind, { title: "Medical licence renewal", type: "licence", category: "DOCUMENTS_AUTHORITIES", recurrence: "ANNUAL", month: monthOf(9), day: dayOf(9), responsibleUserId: noa.id });
  await mkDate(harbor, { title: "Bar membership fees", type: "payment", category: "BUSINESS_FINANCE", recurrence: "ANNUAL", month: monthOf(15), day: dayOf(15), responsibleUserId: itai.id });
  await mkDate(sela, { title: "Passport renewal for Miriam", type: "document", category: "HEALTH_TRAVEL", recurrence: "ONCE", month: monthOf(27), day: dayOf(27), onceDate: at(27, "09:00"), responsibleUserId: maya.id });
  const doneDate2 = await mkDate(sela, { title: "Car annual test", type: "vehicle", category: "VEHICLE_PROPERTY", recurrence: "ANNUAL", month: monthOf(1), day: dayOf(1), responsibleUserId: maya.id });
  await updateImportantDateStatus(superAdmin, doneDate2.id, "HANDLED_CURRENT");

  // -------------------------------------------------------------------------
  // Processes with procedures
  // -------------------------------------------------------------------------

  const step = (title: string, extra: Record<string, unknown> = {}) => ({ title, mode: "MANUAL", offsetBusinessDays: null, actionTags: [], systemIds: [], output: null, verification: null, requiresApproval: false, amountMaxMinor: null, currency: null, channel: null, ...extra });

  const p1 = await addProcess(superAdmin, {
    clientId: orbit.id,
    title: "Supplier payments",
    purpose: "Every approved supplier invoice is paid on time, once, and filed.",
    triggerKinds: ["SCHEDULED"],
    triggerText: "The payment run dates, on the 10th and the 25th",
    ownerId: maya.id,
    backupOwnerId: admin.id,
    slaText: "Paid on the run date",
    requiredSystemIds: [sysBank.id, sysBooks.id],
    approverContactId: jonathan.id,
    approvalPolicyIds: [ruleThreshold.id],
    exceptionPlaybook: "An invoice with no order behind it waits, and Rotem is asked.",
    executorUserId: maya.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(orbit, "finance"),
  } as never);
  await saveProcessVersion(superAdmin, p1.id, {
    baseVersion: 0,
    steps: [
      step("Collect the invoices due", { offsetBusinessDays: -3, systemIds: [sysBooks.id], output: "A list of invoices for this run" }),
      step("Check invoices against orders", { offsetBusinessDays: -2, mode: "ASSISTED", actionTags: ["INVOICE"], verification: "A person reads every line Claude flagged" }),
      step("Approve the payment list", { offsetBusinessDays: -1, actionTags: ["PAYMENT"], requiresApproval: true, amountMaxMinor: 5000000, currency: "ILS" }),
      step("Send the payments", { offsetBusinessDays: 0, actionTags: ["PAYMENT"], systemIds: [sysBank.id], requiresApproval: true, amountMaxMinor: 5000000, currency: "ILS" }),
      step("Send the confirmation to Jonathan", { offsetBusinessDays: 1, mode: "AUTOMATED", channel: "EMAIL", actionTags: ["CLIENT_MESSAGE"], fixedMessage: true, verification: "Check the sent folder the next morning" }),
      step("Reconcile with the bank statement", { offsetBusinessDays: 5, systemIds: [sysBank.id, sysBooks.id], output: "Every payment matched" }),
    ],
    highlights: "Never pay an invoice twice: check the paid folder first.",
    outputs: "Payments sent, invoices filed under Finance / Paid.",
  });
  await approveProcessVersion(superAdmin, p1.id, 1);
  await linkProcessDates(superAdmin, p1.id, [datePaymentRun.id, datePaymentRun10.id]);

  const p2 = await addProcess(superAdmin, {
    clientId: orbit.id,
    title: "Monthly bookkeeping close",
    purpose: "The books for last month are complete and with the accountant by the 7th.",
    triggerKinds: ["CONTINUOUS"],
    triggerText: "Every month",
    ownerId: admin.id,
    backupOwnerId: maya.id,
    checkEveryDays: 30,
    checkText: "Did Eli confirm he has everything?",
    requiredSystemIds: [sysBooks.id, sysDrive.id],
    executorUserId: maya.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(orbit, "kickoff"),
  } as never);
  await saveProcessVersion(superAdmin, p2.id, {
    baseVersion: 0,
    steps: [
      step("Record the month's transactions", { offsetBusinessDays: 0, systemIds: [sysBooks.id] }),
      step("Match receipts to card expenses", { offsetBusinessDays: 2, mode: "ASSISTED", verification: "A person checks every unmatched line" }),
      step("Send the month to the accountant", { offsetBusinessDays: 5, channel: "EMAIL", actionTags: ["DATA_EXPORT"], output: "Email to Eli with the export" }),
    ],
    highlights: "Ask Jonathan about card expenses with no receipt before the 3rd.",
  });
  await approveProcessVersion(superAdmin, p2.id, 1);

  const p3 = await addProcess(superAdmin, {
    clientId: orbit.id,
    title: "New employee onboarding",
    purpose: "A new employee has a laptop, a card and a desk on day one.",
    triggerKinds: ["EVENT"],
    triggerText: "Shira tells us about a new hire",
    ownerId: maya.id,
    executorUserId: maya.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(orbit, "weekly"),
  } as never);
  await saveProcessVersion(superAdmin, p3.id, {
    baseVersion: 0,
    steps: [
      step("Order a laptop from NetSecure", { offsetBusinessDays: -5, actionTags: ["PURCHASE"] }),
      step("Order a door card", { offsetBusinessDays: -3 }),
      step("Prepare the desk", { offsetBusinessDays: -1 }),
      step("Send the welcome email", { offsetBusinessDays: 0, channel: "EMAIL", actionTags: ["CLIENT_MESSAGE"] }),
    ],
  });
  // Left as a draft on purpose: it waits on the approvals screen.

  const p4 = await addProcess(superAdmin, {
    clientId: meridian.id,
    title: "Late rent follow-up",
    purpose: "Every tenant who is late hears from us within three business days.",
    triggerKinds: ["SCHEDULED"],
    triggerText: "The 5th of every month",
    ownerId: itai.id,
    executorUserId: itai.id,
    transitionStatus: "WITH_ANKORA",
    knowledgeStatus: "CONFIRMED",
    sources: src(meridian, "intro"),
  } as never);
  await saveProcessVersion(superAdmin, p4.id, {
    baseVersion: 0,
    steps: [step("List tenants who have not paid", { offsetBusinessDays: 0 }), step("Email a reminder", { offsetBusinessDays: 1, channel: "EMAIL", actionTags: ["CLIENT_MESSAGE"] }), step("Call the ones still late", { offsetBusinessDays: 3, channel: "PHONE" })],
  });
  await approveProcessVersion(superAdmin, p4.id, 1);
  const dateRentDue = await mkDate(meridian, { title: "Rent collection day", type: "payment", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: 5, responsibleUserId: itai.id });
  await linkProcessDates(superAdmin, p4.id, [dateRentDue.id]);
  await mkDate(northwind, { title: "Staff training day", type: "event", category: "GENERAL", recurrence: "ANNUAL", month: monthOf(-3), day: dayOf(-3) });
  await mkDate(harbor, { title: "Monthly invoice to Harbor & Pine", type: "invoice", category: "BUSINESS_FINANCE", recurrence: "MONTHLY", month: 1, day: dayOf(-1) });
  await mkDate(harbor, { title: "Court filing deadline, Harbor v. Northline", type: "deadline", category: "DOCUMENTS_AUTHORITIES", recurrence: "ONCE", month: monthOf(1), day: dayOf(1), onceDate: at(1, "09:00") });

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
    title: "Compare three IT support suppliers",
    category: catResearch,
    status: "IN_PROGRESS",
    priority: "HIGH",
    assignee: superAdmin,
    supervisor: admin,
    due: 4,
    createdDaysAgo: 9,
    clientTitle: "Comparing three IT suppliers for you",
    clientRequest: "Tell us by Sunday whether the 24/7 phone line matters to you.",
    description: [
      "Three suppliers to compare, **by Thursday**:",
      "",
      "- NetSecure IT, the current one, contract `NS-2025-118`",
      "- Cloudline, quoted last week",
      "- Ironwall, recommended by Rotem",
      "",
      "What matters to Orbit is *response time*, not the price. The current contract is in the [shared drive](https://example.com/contracts).",
    ].join("\n"),
    steps: [
      { title: "Collect the current NetSecure contract", done: true },
      { title: "Get quotes from Cloudline and Ironwall", done: true, assignee: maya },
      { title: "Compare response times and prices", due: 2 },
      { title: "Write a one-page recommendation for Rotem", due: 4 },
    ],
    comments: [
      { author: maya, body: "Cloudline's quote is in the drive. Ironwall asked for the number of laptops, I sent 42.", daysAgo: 4 },
      { author: admin, body: "Rotem mentioned on the weekly call that the 24/7 line matters more than the price. Worth leading with that.", daysAgo: 3 },
      { author: superAdmin, body: "Ironwall's quote arrived this morning. Comparing tomorrow.", daysAgo: 1 },
    ],
  });
  await prisma.taskPlan.create({
    data: {
      taskId: "demo-task-research-competitors",
      version: 1,
      body: "Collect the three offers, put response time, price and contract length side by side, and send Rotem a one-page recommendation with our pick.",
      steps: ["Collect the current NetSecure contract", "Get quotes from Cloudline and Ironwall", "Compare response times and prices", "Write a one-page recommendation for Rotem"],
      status: "APPROVED",
      createdById: superAdmin.id,
      approvedById: admin.id,
      approvedAt: daysAgo(8),
      stepsAppliedAt: daysAgo(8),
      createdAt: daysAgo(8),
    },
  });

  await mkTask({ id: "demo-task-onboarding-kickoff", client: orbit, title: "Kickoff meeting with Orbit", category: catOnboarding, status: "DONE", assignee: admin, completedDaysAgo: 30, createdDaysAgo: 40, clientTitle: "Your kickoff meeting", clientOutcome: "We met, mapped everything that runs in your office, and left with a plan for the first three months." });
  await mkTask({ id: "demo-task-waiting-on-client", client: orbit, title: "Technician visit for the air conditioning", category: catSuppliers, status: "IN_PROGRESS", assignee: maya, due: 3, clientTitle: "Choose a date for the technician visit", blocked: { on: "CLIENT", reason: "Three dates sent, waiting for Rotem to choose", sinceDaysAgo: 2 }, createdDaysAgo: 6 });
  await mkTask({ id: "demo-task-orbit-cleaning", client: orbit, title: "Switch cleaning supplier", category: catSuppliers, status: "IN_PROGRESS", priority: "HIGH", assignee: maya, supervisor: superAdmin, requiresApproval: true, due: 6, clientTitle: "Choosing a new cleaning supplier", createdDaysAgo: 12,
    steps: [{ title: "Ask three suppliers for quotes", done: true }, { title: "Visit the office with the top two", done: true }, { title: "Send Rotem the recommendation", due: 2 }, { title: "Give CleanCo a month's notice", due: 6 }],
    comments: [{ author: maya, body: "SparkleOffice can start on the 1st and is 12% cheaper.", daysAgo: 2 }] });
  await mkTask({ id: "demo-task-orbit-lease", client: orbit, title: "Renew the office lease", category: catAdmin, status: "IN_PROGRESS", assignee: admin, due: 20, clientTitle: "Renewing your office lease", createdDaysAgo: 15, blocked: { on: "SUPPLIER", reason: "The landlord's lawyer is reviewing our changes", sinceDaysAgo: 5 } });
  await mkTask({ id: "demo-task-orbit-payroll", client: orbit, title: "Payroll inputs for November", category: catHr, status: "OPEN", assignee: maya, due: 8, createdDaysAgo: 3 });
  await mkTask({ id: "demo-task-orbit-laptops", client: orbit, title: "Order laptops for two new hires", category: catSuppliers, status: "PENDING_APPROVAL", assignee: maya, supervisor: superAdmin, requiresApproval: true, due: 1, priority: "URGENT", createdDaysAgo: 5, clientTitle: "Laptops for your two new hires", clientOutcome: "Two laptops are ordered and arrive Sunday morning.",
    steps: [{ title: "Get the specs from Shira", done: true }, { title: "Order from NetSecure", done: true }] });
  await mkTask({ id: "demo-task-orbit-rent", client: orbit, title: "Pay the October office rent", category: catBooks, status: "DONE", assignee: maya, completedDaysAgo: 4, createdDaysAgo: 10, clientTitle: "October office rent", clientOutcome: "Paid, and the receipt is in your file." });
  await mkTask({ id: "demo-task-orbit-coffee", client: orbit, title: "New coffee machine", category: catSuppliers, status: "DONE", assignee: itai, completedDaysAgo: 6, createdDaysAgo: 14, clientTitle: "A new coffee machine for the kitchen", clientOutcome: "Installed on Tuesday, with a year of service included.", supplier: { name: "Bean There Coffee (demo)", experience: "GOOD" } });
  await mkTask({ id: "demo-task-orbit-insurance", client: orbit, title: "Collect insurance renewal quotes", category: catAdmin, status: "DONE", assignee: admin, completedDaysAgo: 1, createdDaysAgo: 12, clientTitle: "Office insurance renewal quotes", clientOutcome: "Three quotes collected. Shield Insurance stays the best value." });
  await mkTask({ id: "demo-task-orbit-quarterly", client: orbit, title: "Prepare the quarterly expense report", category: catBooks, status: "OPEN", assignee: superAdmin, due: 13, createdDaysAgo: 2, clientTitle: "Your quarterly expense report" });

  await mkTask({ id: "demo-task-meridian-weekly", client: meridian, title: "Weekly sync with Daniel", category: catMeetings, status: "OPEN", assignee: superAdmin, due: 2, createdDaysAgo: 7 });
  await mkTask({ id: "demo-task-meridian-tenants", client: meridian, title: "Chase three late tenants", category: catBooks, status: "IN_PROGRESS", priority: "HIGH", assignee: itai, supervisor: superAdmin, due: 1, createdDaysAgo: 6,
    steps: [{ title: "Email reminders", done: true }, { title: "Call the two who did not answer", due: 1 }] });
  await mkTask({ id: "demo-task-supervised-fixture", client: meridian, title: "Replace the cleaning supplier", category: catSuppliers, status: "PENDING_APPROVAL", assignee: itai, supervisor: superAdmin, requiresApproval: true, due: 0, createdDaysAgo: 11, description: "Price against two others, then approval before signing." });
  await mkTask({ id: "demo-task-board-fixture", client: meridian, title: "Renew the office insurance", category: catAdmin, status: "OPEN", assignee: superAdmin, due: 9, createdDaysAgo: 4 });
  await mkTask({ id: "demo-task-board-supervised", client: meridian, title: "Approve the quarterly budget", category: catBooks, status: "OPEN", assignee: itai, supervisor: superAdmin, requiresApproval: true, due: 11, createdDaysAgo: 4 });
  await mkTask({ id: "demo-task-meridian-repair", client: meridian, title: "Roof repair quotes for building B", category: catSuppliers, status: "IN_PROGRESS", assignee: superAdmin, due: 5, createdDaysAgo: 9, blocked: { on: "SUPPLIER", reason: "Second roofer comes on Sunday to measure", sinceDaysAgo: 3 } });

  await mkTask({ id: "demo-task-northwind-licences", client: northwind, title: "Collect staff licence copies", category: catAdmin, status: "IN_PROGRESS", assignee: maya, due: 7, createdDaysAgo: 10, steps: [{ title: "Doctors", done: true }, { title: "Nurses", done: false }, { title: "Reception", done: false }] });
  await mkTask({ id: "demo-task-northwind-schedule", client: northwind, title: "Set up appointment reminders", category: catResearch, status: "OPEN", priority: "HIGH", assignee: superAdmin, due: 3, createdDaysAgo: 3, blocked: { on: "INTERNAL", reason: "Waiting for Noa's notes from the clinic visit", sinceDaysAgo: 1 } });
  await mkTask({ id: "demo-task-northwind-supplies", client: northwind, title: "Monthly medical supplies order", category: catSuppliers, status: "DONE", assignee: noa, completedDaysAgo: 3, createdDaysAgo: 8 });

  await mkTask({ id: "demo-task-harbor-travel", client: harbor, title: "Book Sam's trip to the London hearing", category: catSuppliers, status: "IN_PROGRESS", assignee: itai, due: 6, createdDaysAgo: 5 });
  await mkTask({ id: "demo-task-harbor-fees", client: harbor, title: "Pay this month's court fees", category: catBooks, status: "OPEN", assignee: superAdmin, supervisor: admin, due: 1, priority: "URGENT", createdDaysAgo: 1 });

  await mkTask({ id: "demo-task-sela-passport", client: sela, title: "Passport renewal appointment", category: catTravel, status: "OPEN", assignee: maya, due: 10, createdDaysAgo: 4 });
  await mkTask({ id: "demo-task-sela-holiday", client: sela, title: "Plan the family holiday in December", category: catTravel, status: "IN_PROGRESS", assignee: maya, supervisor: superAdmin, due: 14, createdDaysAgo: 7,
    steps: [{ title: "Three hotel options", done: true }, { title: "Flights", due: 5 }, { title: "Car rental", due: 9 }] });
  await prisma.taskPlan.create({
    data: {
      taskId: "demo-task-sela-holiday",
      version: 1,
      body: "Book flights first while prices hold, then the hotel Miriam picks, then a car. Send her one message with all three for a yes.",
      steps: ["Book flights", "Book the hotel", "Rent a car", "Send Miriam the summary"],
      status: "DRAFT",
      createdById: maya.id,
      createdAt: daysAgo(1),
    },
  });

  await mkTask({ id: "demo-task-calendar-fixture", client: meridian, title: "Book a technician for the air conditioning", category: catSuppliers, status: "OPEN", assignee: itai, createdDaysAgo: 2 });
  await mkTask({ id: "demo-task-screen-fixture", client: meridian, title: "Coordinate with the building committee", category: catMeetings, status: "OPEN", assignee: itai, due: 12, createdDaysAgo: 2 });
  await mkTask({ id: "demo-task-old-proposal", client: meridian, title: "Old price quote", category: catResearch, status: "ARCHIVED", createdDaysAgo: 60 });
  await mkTask({ id: "demo-task-meridian-rent-summary", client: meridian, title: "Send Daniel the October rent summary", category: catBooks, status: "DONE", assignee: superAdmin, due: -2, completedDaysAgo: 2, createdDaysAgo: 9 });
  await mkTask({ id: "demo-task-northwind-signoff", client: northwind, title: "Sign off the supplies order", category: catSuppliers, status: "DONE", assignee: superAdmin, due: -3, completedDaysAgo: 3, createdDaysAgo: 6 });
  await mkTask({ id: "demo-task-orbit-insurance-compare", client: orbit, title: "Send Rotem the insurance comparison", category: catAdmin, status: "IN_PROGRESS", assignee: superAdmin, due: -1, createdDaysAgo: 5 });
  await mkTask({ id: "demo-task-harbor-call", client: harbor, title: "Call Sam about the London hearing dates", category: catMeetings, status: "OPEN", assignee: superAdmin, due: 0, createdDaysAgo: 2 });
  await mkTask({ id: "demo-task-internal-guide", client: internal, title: "Update the onboarding checklist", category: catAdmin, status: "OPEN", assignee: superAdmin, due: 15, createdDaysAgo: 6 });

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
    { user: maya, client: orbit, categories: [catSuppliers, catBooks, catHr, catOnboarding], taskIds: ["demo-task-orbit-cleaning", "demo-task-waiting-on-client", "demo-task-orbit-laptops", null], notes: ["Supplier calls", "Invoices for the payment run", "Payroll inputs", "Office walk-through"] },
    { user: maya, client: northwind, categories: [catAdmin], taskIds: ["demo-task-northwind-licences", null], notes: ["Licence copies", "Filing"] },
    { user: maya, client: sela, categories: [catTravel], taskIds: ["demo-task-sela-holiday", null], notes: ["Hotel options", "Calls with Miriam"] },
    { user: itai, client: meridian, categories: [catBooks, catSuppliers], taskIds: ["demo-task-meridian-tenants", "demo-task-supervised-fixture", null], notes: ["Tenant reminders", "Supplier quotes", "Rent ledger"] },
    { user: itai, client: harbor, categories: [catSuppliers], taskIds: ["demo-task-harbor-travel", null], notes: ["Flights and hotel", "Court fee forms"] },
    { user: noa, client: northwind, categories: [catSuppliers, catAdmin], taskIds: ["demo-task-northwind-supplies", null], notes: ["Supplies order", "Clinic visit notes"] },
    { user: admin, client: orbit, categories: [catMeetings, catAdmin], taskIds: ["demo-task-orbit-lease", "demo-task-orbit-insurance", null], notes: ["Weekly sync with Rotem", "Lease review", "Insurance quotes"] },
    { user: superAdmin, client: orbit, categories: [catResearch], taskIds: ["demo-task-research-competitors"], notes: ["IT supplier comparison"] },
    { user: superAdmin, client: meridian, categories: [catMeetings, catSuppliers], taskIds: ["demo-task-meridian-weekly", "demo-task-meridian-repair"], notes: ["Weekly sync", "Roof quotes"] },
    { user: superAdmin, client: northwind, categories: [catResearch], taskIds: ["demo-task-northwind-schedule"], notes: ["Reminder options"] },
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
          backdateReason: dayOffset < 0 ? "Logged from the day's notes (demo)" : null,
          closedBankOverride: { reason: "Demo history (demo)" },
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
    await recordHourBankAdjustment(superAdmin, orbit.id, { hourBankId: orbitBank.id, minutes: 30, reason: "Credit for the meeting that ran over last week (demo)" }).catch((err: unknown) => console.warn("  adjustment skipped:", err instanceof Error ? err.message : err));
  }

  // Running timers: Maya on Orbit, Itai on Meridian.
  const running1 = await startTimer(maya, { clientId: orbit.id, categoryId: catSuppliers.id, taskId: "demo-task-orbit-cleaning", note: "Calling SparkleOffice about the start date" });
  await prisma.timeEntry.update({ where: { id: running1.id }, data: { startAt: new Date(NOW.getTime() - 87 * MIN) } });
  const running2 = await startTimer(itai, { clientId: meridian.id, categoryId: catBooks.id, taskId: "demo-task-meridian-tenants", note: "Calling the two tenants who did not answer" });
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
    question: "Which date works for the air conditioning technician?",
    background: "Two free slots this week. The earlier one is also cheaper, because it is part of their route.",
    amountMinor: 90000,
    dueAt: daysAhead(2),
    options: [
      { label: "Tuesday morning, 8:00 to 10:00", amountMinor: 90000, recommended: true },
      { label: "Thursday afternoon, 14:00 to 16:00", amountMinor: 105000 },
    ],
  });
  await createDecision(admin, {
    clientId: orbit.id,
    taskId: "demo-task-orbit-cleaning",
    question: "Which cleaning supplier should we switch to?",
    background: "We visited the office with both. SparkleOffice is cheaper and can start on the 1st; ProShine has a better record with offices our size.",
    amountMinor: 380000,
    dueAt: daysAhead(5),
    options: [
      { label: "SparkleOffice, 3,700 ILS a month", detail: "Starts on the 1st, 3 times a week", amountMinor: 370000, recommended: true },
      { label: "ProShine, 4,100 ILS a month", detail: "Starts mid month, daily light cleaning", amountMinor: 410000 },
      { label: "Stay with CleanCo for now", amountMinor: 420000 },
    ],
  });
  const answered = await createDecision(admin, {
    clientId: orbit.id,
    taskId: "demo-task-orbit-coffee",
    question: "Which coffee machine should we order?",
    background: "Both include a year of service.",
    amountMinor: 450000,
    options: [
      { label: "Bean There Pro, 4,500 ILS", amountMinor: 450000, recommended: true },
      { label: "Basic capsule machine, 1,200 ILS", amountMinor: 120000 },
    ],
  });
  const answeredRow = await prisma.decision.findUnique({ where: { id: answered.id }, include: { options: true } });
  if (answeredRow) await respondToDecision(clientAdmin, answeredRow.id, answeredRow.options[0].id);
  await prisma.decision.update({ where: { id: answered.id }, data: { createdAt: daysAgo(12) } });

  // -------------------------------------------------------------------------
  // Portal: documents, monthly summary, report schedules and runs
  // -------------------------------------------------------------------------

  const doc = (title: string, kind: "CONTRACT" | "INVOICE" | "CERTIFICATE" | "POLICY" | "OTHER", daysOld: number, taskId?: string) =>
    prisma.clientDocument.create({ data: { clientId: orbit.id, title, kind, driveFileId: `demo-drive-file-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, mimeType: "application/pdf", sizeBytes: 180_000 + Math.floor(rand() * 400_000), clientVisible: true, uploadedById: admin.id, taskId: taskId ?? null, createdAt: daysAgo(daysOld) } });
  await doc("Service agreement with Ankora (demo).pdf", "CONTRACT", 45);
  await doc("Office insurance policy 2026 (demo).pdf", "CERTIFICATE", 30);
  await doc("October rent receipt (demo).pdf", "INVOICE", 4, "demo-task-orbit-rent");
  await doc("Coffee machine warranty (demo).pdf", "OTHER", 6, "demo-task-orbit-coffee");
  await doc("Fire safety certificate (demo).pdf", "CERTIFICATE", 2);

  await prisma.portalSummary.create({
    data: {
      clientId: orbit.id,
      periodStart: utc(lastMonth),
      periodEnd: utc(thisMonth),
      draft: "Last month we closed the kickoff plan's first stage: the payment runs now go out on the 10th and the 25th, the coffee machine is in, and the insurance quotes are collected. Next month: the new cleaning supplier and the lease renewal.",
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
      draft: "So far this month: October's rent is paid, the insurance quotes are in, and two laptops are ordered for the new hires. Waiting on you: the technician date.",
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
    data: { clientId: meridian.id, sourceId: (await prisma.clientSource.findFirst({ where: { clientId: meridian.id, code: S[meridian.id].intro } }))!.id, via: "MCP", note: "From the introduction meeting with Daniel", createdById: admin.id, createdAt: daysAgo(1) },
  });
  const proposals: { target: "FACT" | "CONTACT" | "POLICY" | "SYSTEM"; payload: Record<string, unknown>; reason: string; quote?: string; confidence: string }[] = [
    { target: "FACT", payload: { kind: "PREFERENCE", topic: "COMMUNICATION", body: "Daniel wants one summary email on Fridays, not daily updates.", sources: [{ code: S[meridian.id].intro, at: "04:12" }] }, reason: "Said twice in the meeting", quote: "Just send me one email on Friday with everything.", confidence: "HIGH" },
    { target: "FACT", payload: { kind: "SCOPE_IN", topic: "SUPPLIERS", body: "We coordinate all repairs in the two buildings, up to the approval threshold.", sources: [{ code: S[meridian.id].intro, at: "11:40" }] }, reason: "Agreed scope", confidence: "HIGH" },
    { target: "CONTACT", payload: { name: "Avi Rosen (demo)", role: "Building maintenance", relationship: "SUPPLIER", phones: ["050-000-0004"], sources: [{ code: S[meridian.id].intro, at: "15:02" }] }, reason: "The person to call for repairs", confidence: "MEDIUM" },
    { target: "SYSTEM", payload: { systemName: "Tenant portal (demo)", purpose: "Tenants report faults here", ourPermission: "VIEWER", accessStatus: "PENDING", sources: [{ code: S[meridian.id].intro, at: "18:30" }] }, reason: "We need access to see open faults", confidence: "MEDIUM" },
    { target: "POLICY", payload: { kind: "TIMING", title: "Late rent reminders go out on the 5th", statement: "A tenant who has not paid by the 5th gets a reminder that day.", sources: [{ code: S[meridian.id].intro, at: "21:15" }] }, reason: "Daniel's rule for tenants", confidence: "HIGH" },
    { target: "FACT", payload: { kind: "QUESTION", topic: "PAYMENTS", body: "Who signs repair payments when Daniel is abroad?", toResolve: "Ask Daniel on the next call", sources: [{ code: S[meridian.id].intro, at: "25:48" }] }, reason: "Not answered in the meeting", confidence: "LOW" },
  ];
  for (const p of proposals) {
    await prisma.knowledgeProposal.create({ data: { batchId: batch.id, clientId: meridian.id, target: p.target, payload: p.payload as Prisma.InputJsonValue, reason: p.reason, quote: p.quote ?? null, confidence: p.confidence, createdAt: daysAgo(1) } });
  }
  const batch2 = await prisma.knowledgeBatch.create({
    data: { clientId: orbit.id, sourceId: (await prisma.clientSource.findFirst({ where: { clientId: orbit.id, code: S[orbit.id].weekly } }))!.id, via: "MCP", note: "From the weekly sync, week 44", createdById: maya.id, createdAt: daysAgo(0) },
  });
  for (const p of [
    { target: "FACT", payload: { kind: "TEMPORARY", topic: "OTHER", body: "The kitchen is closed for renovation until the end of the month.", validUntilEvent: "The renovation is finished", sources: [{ code: S[orbit.id].weekly, at: "02:30" }] }, reason: "Affects deliveries", confidence: "HIGH" },
    { target: "FACT", payload: { kind: "REQUIREMENT", topic: "REPORTING", body: "The quarterly expense report includes card spending by person.", sources: [{ code: S[orbit.id].weekly, at: "09:05" }] }, reason: "Jonathan asked for it", confidence: "MEDIUM" },
  ]) {
    await prisma.knowledgeProposal.create({ data: { batchId: batch2.id, clientId: orbit.id, target: p.target as "FACT", payload: p.payload as Prisma.InputJsonValue, reason: p.reason, confidence: p.confidence } });
  }

  // The extraction guide: one approved version, and a proposed second.
  await prisma.extractionGuide.create({
    data: {
      version: 1,
      body: "- Extract only what was said explicitly.\n- Every item cites its source and the minute in the recording.\n- Never copy passwords or card numbers.\n- A rule needs the client's own words, not our summary.",
      note: "First version",
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
      body: "- Extract only what was said explicitly.\n- Every item cites its source and the minute in the recording.\n- Never copy passwords or card numbers.\n- A rule needs the client's own words, not our summary.\n- A name heard once is a question, not a contact.",
      note: "Names heard once become questions",
      state: "DRAFT",
      createdById: admin.id,
      createdAt: daysAgo(1),
    },
  });

  // -------------------------------------------------------------------------
  // Integrations
  // -------------------------------------------------------------------------

  await prisma.mcpAccessToken.create({
    data: { userId: superAdmin.id, label: "Alex's MacBook (demo)", tokenHash: "demo-grant-not-a-real-token-hash-0000000000000000000000000000", tokenVersion: 0, expiresAt: daysAhead(365) },
  });

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  const notify = (user: User, type: string, title: string, body: string, hoursAgo: number, read = false, entity?: { type: string; id: string }) =>
    prisma.notification.create({ data: { userId: user.id, type, title, body, entityType: entity?.type ?? null, entityId: entity?.id ?? null, createdAt: new Date(NOW.getTime() - hoursAgo * 60 * MIN), readAt: read ? new Date(NOW.getTime() - (hoursAgo - 1) * 60 * MIN) : null } });
  for (const u of [superAdmin, maya]) {
    await notify(u, "task_assigned", "New task for you", "Pay this month's court fees · Harbor & Pine Law (demo)", 2, false, { type: "Task", id: "demo-task-harbor-fees" });
    await notify(u, "task_supervisor", "You supervise a task", "Switch cleaning supplier · Orbit Technologies (demo)", 5, false, { type: "Task", id: "demo-task-orbit-cleaning" });
    await notify(u, "decision_answered", "Rotem answered a decision", "Which coffee machine should we order? Bean There Pro, 4,500 ILS", 26, false);
    await notify(u, "hour_bank_alert", "Meridian Group's package is almost used", "Over 80% of the prepaid hours are used. Time to talk about the next package.", 30, true);
    await notify(u, "important_date", "Coming up: Office insurance renewal", "Orbit Technologies (demo), in 18 days", 50, true);
    await notify(u, "long_running_timer", "A timer has been running for a long time", "The timer for Orbit Technologies has been running for 9 hours. Check whether it should be stopped.", 70, true);
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
  await prisma.importantDate.updateMany({ where: { clientId: orbit.id, title: { in: ["Supplier payment run", "Office insurance renewal", "Office lease option deadline", "Annual fire safety inspection"] } }, data: { clientVisible: true } });
  await prisma.user.update({ where: { id: superAdmin.id }, data: { whatsappNumber: "050-000-0005" } });

  // R14 words why an item backed only by Ankora's own notes is uncertain,
  // and stores that sentence in Hebrew. The English file says it in English.
  const why = "Confirmation from the client or their vendor: every source is an Ankora document.";
  for (const table of ["client_facts", "client_contacts", "client_organizations", "system_access", "client_policies", "processes", "request_types"]) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "toResolve" = $1 WHERE "toResolve" ~ E'\\xD7[\\x90-\\xAA]'`, why);
  }

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

  console.log("Done. Demo accounts (all share the password below):");
  console.log(`  password: ${DEMO_PASSWORD}`);
  for (const u of [superAdmin, admin, maya, itai, noa, clientAdmin]) console.log(`  ${u.email} (${u.role})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
