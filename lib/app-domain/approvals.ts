import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { countPendingProposals } from "@/lib/app-domain/knowledge-proposals";
import { listAwaitingAssignment } from "@/lib/app-domain/batch-assignment";
import { sentForApprovalAt } from "@/lib/app-domain/task-approval-times";
import { OPEN_STATUSES } from "@/lib/app-domain/tasks";
import { readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { approvalsHref, tabCounts, type ApprovalItem, type ReviewItem } from "@/lib/approvals";
import { SCHEDULED_NO_DATE_NOTE } from "@/lib/client-control";
import { loweredBySource } from "@/lib/app-domain/source-confirmation";
import { coveredTasksForClients } from "@/lib/app-domain/process-overlap";

// What is waiting on one person's approval, read from the state each thing
// is in now (lib/approvals.ts says why this screen exists). Each kind is
// scoped the way its own screen already decides who may approve it, so a
// row never offers a button the server would refuse:
//
//   tasks       the task's supervisor (assertApprovable).
//   exceptions  the client's rule approvers, or whoever may approve
//               exceptions when the client names none (canApproveForClient).
//   rules       a manager (approveClientPolicy).
//   procedures  a manager (approveProcessVersion).
//   knowledge   anyone on the client (the review screen, as it was).
//   plans       the task's assignee and supervisor (approveTaskPlan writes
//               for anyone on the task; these are the two it is waiting on).
//   summaries   a manager, or the client's account manager.
//   guide       a manager (approveGuide).

type Scope = { user: User; manager: boolean; clients: { id: string; name: string; accountManagerId: string | null; ruleApproverIds: string[] }[] };

async function scopeOf(user: User): Promise<Scope> {
  const clients = can(user.role, "time_entry.create_self") ? await listAccessibleClients(user) : [];
  return { user, manager: canManageClients(user.role), clients };
}

function clip(text: string, max = 160): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const itemHref = (clientId: string, id: string) => `/app/clients/${clientId}?tab=file#item-${id}`;

async function namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

const day = (d: Date) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
const month = (d: Date) => new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);

async function tasks(s: Scope): Promise<ApprovalItem[]> {
  const ids = s.clients.map((c) => c.id);
  if (ids.length === 0) return [];
  const rows = await prisma.task.findMany({
    where: { supervisorId: s.user.id, status: "PENDING_APPROVAL", deletedAt: null, clientId: { in: ids } },
    select: {
      id: true,
      title: true,
      parentId: true,
      updatedAt: true,
      client: { select: { id: true, name: true } },
      parent: { select: { title: true } },
      assignedTo: { select: { name: true } },
    },
  });
  const sent = await sentForApprovalAt(rows.map((t) => t.id));
  return rows.map((t) => ({
    kind: "task",
    id: t.id,
    clientId: t.client.id,
    clientName: t.client.name,
    title: t.title,
    detail: t.parent ? `שלב במשימה: ${t.parent.title}` : null,
    since: sent.get(t.id) ?? t.updatedAt,
    by: t.assignedTo?.name ?? null,
    href: `/app/tasks/${t.parentId ?? t.id}`,
    actions: { approve: "אישור וסגירה", reject: { label: "החזרה לביצוע", note: false } },
  }));
}

async function exceptions(s: Scope): Promise<ApprovalItem[]> {
  // canApproveForClient, for every client at once.
  const mine = s.clients.filter((c) => (c.ruleApproverIds.length > 0 ? c.ruleApproverIds.includes(s.user.id) : s.user.canApproveExceptions));
  if (mine.length === 0) return [];
  const rows = await prisma.policyException.findMany({
    where: { status: "REQUESTED", clientId: { in: mine.map((c) => c.id) } },
    include: { policy: { select: { id: true, title: true } }, client: { select: { name: true } } },
  });
  const names = await namesOf(rows.map((r) => r.requestedById));
  return rows.map((e) => ({
    kind: "exception",
    id: e.id,
    clientId: e.clientId,
    clientName: e.client.name,
    title: e.what,
    detail: `חריגה מהכלל "${e.policy.title}" עד ${day(e.validUntil)}. למה: ${e.reason}`,
    since: e.createdAt,
    by: names.get(e.requestedById) ?? null,
    href: itemHref(e.clientId, e.policy.id),
    actions: { approve: "אישור החריגה", reject: { label: "דחייה", note: true } },
  }));
}

async function rules(s: Scope): Promise<ApprovalItem[]> {
  if (!s.manager || s.clients.length === 0) return [];
  const rows = await prisma.clientPolicy.findMany({
    where: { status: "PROPOSED", deletedAt: null, clientId: { in: s.clients.map((c) => c.id) } },
    include: { client: { select: { name: true } } },
  });
  const names = await namesOf(rows.map((r) => r.createdById));
  return rows.map((p) => {
    const confirmed = p.knowledgeStatus === "CONFIRMED";
    return {
      kind: "rule",
      id: p.id,
      clientId: p.clientId,
      clientName: p.client.name,
      title: p.title,
      detail: clip(p.statement, 220),
      since: p.createdAt,
      by: names.get(p.createdById ?? "") ?? null,
      href: itemHref(p.clientId, p.id),
      // approveClientPolicy refuses a rule that is not yet confirmed, so
      // the row says what would confirm it instead of offering a button.
      blocked: confirmed ? null : `צריך אימות מול הלקוח${p.toResolve ? `: ${p.toResolve}` : "."}`,
      actions: { approve: confirmed ? "אישור הכלל" : null, reject: { label: "הסרה", note: false } },
    };
  });
}

async function procedures(s: Scope): Promise<ApprovalItem[]> {
  if (!s.manager || s.clients.length === 0) return [];
  const drafts = await prisma.processVersion.findMany({
    where: { status: "DRAFT", process: { deletedAt: null, status: { not: "RETIRED" }, clientId: { in: s.clients.map((c) => c.id) } } },
    include: { process: { select: { id: true, code: true, title: true, clientId: true, client: { select: { name: true } } } } },
  });
  if (drafts.length === 0) return [];
  // Only the newest version is approved (approveProcessVersion).
  const latest = await prisma.processVersion.groupBy({
    by: ["processId"],
    where: { processId: { in: [...new Set(drafts.map((d) => d.processId))] } },
    _max: { version: true },
  });
  const newest = new Map(latest.map((l) => [l.processId, l._max.version]));
  const current = drafts.filter((d) => newest.get(d.processId) === d.version);
  const names = await namesOf(current.map((d) => d.createdById));
  return current.map((d) => ({
    kind: "procedure",
    id: d.processId,
    version: d.version,
    clientId: d.process.clientId,
    clientName: d.process.client.name,
    title: `${d.process.code} ${d.process.title}`,
    detail: d.changeNote ? `גרסה ${d.version}: ${clip(d.changeNote)}` : `גרסה ${d.version} של הנוהל`,
    since: d.createdAt,
    by: names.get(d.createdById ?? "") ?? null,
    href: itemHref(d.process.clientId, d.processId),
    actions: { approve: "אישור הנוהל", reject: null },
  }));
}

async function knowledge(s: Scope): Promise<ApprovalItem[]> {
  if (s.clients.length === 0) return [];
  const batches = await prisma.knowledgeBatch.findMany({
    where: { clientId: { in: s.clients.map((c) => c.id) }, closedAt: null, awaitingAssignment: false, proposals: { some: { state: "PENDING" } } },
    select: {
      id: true,
      clientId: true,
      sourceId: true,
      note: true,
      createdById: true,
      createdAt: true,
      client: { select: { name: true } },
      _count: { select: { proposals: { where: { state: "PENDING" } } } },
    },
  });
  const sources = await prisma.clientSource.findMany({
    where: { id: { in: batches.map((b) => b.sourceId).filter((id): id is string => !!id) } },
    select: { id: true, title: true },
  });
  const sourceTitle = new Map(sources.map((x) => [x.id, x.title]));
  const names = await namesOf(batches.map((b) => b.createdById));
  return batches.map((b) => {
    const n = b._count.proposals;
    const from = b.sourceId ? sourceTitle.get(b.sourceId) : null;
    return {
      kind: "knowledge",
      id: b.id,
      clientId: b.clientId,
      clientName: b.client.name,
      title: `${n === 1 ? "הצעה אחת" : `${n} הצעות`} לתיק${from ? ` מ"${from}"` : ""}`,
      detail: b.note ? clip(b.note) : null,
      since: b.createdAt,
      by: names.get(b.createdById ?? "") ?? null,
      href: approvalsHref("knowledge", b.clientId),
      // Proposals are decided one by one, with their sources, on the
      // review screen itself: the row leads there.
      actions: { approve: null, reject: null },
      weight: n,
    };
  });
}

async function plans(s: Scope): Promise<ApprovalItem[]> {
  if (s.clients.length === 0) return [];
  const drafts = await prisma.taskPlan.findMany({
    where: {
      status: "DRAFT",
      task: {
        deletedAt: null,
        parentId: null,
        status: { in: OPEN_STATUSES },
        clientId: { in: s.clients.map((c) => c.id) },
        OR: [{ assignedToId: s.user.id }, { supervisorId: s.user.id }],
      },
    },
    include: { task: { select: { id: true, title: true, clientId: true, client: { select: { name: true } } } }, createdBy: { select: { name: true } } },
  });
  if (drafts.length === 0) return [];
  const latest = await prisma.taskPlan.groupBy({ by: ["taskId"], where: { taskId: { in: [...new Set(drafts.map((d) => d.taskId))] } }, _max: { version: true } });
  const newest = new Map(latest.map((l) => [l.taskId, l._max.version]));
  return drafts
    .filter((d) => newest.get(d.taskId) === d.version)
    .map((d) => ({
      kind: "plan",
      id: d.taskId,
      version: d.version,
      clientId: d.task.clientId,
      clientName: d.task.client.name,
      title: d.task.title,
      detail: `תוכנית, גרסה ${d.version}: ${clip(d.body)}`,
      since: d.createdAt,
      by: d.createdBy?.name ?? (d.origin === "APP" ? null : "Claude"),
      href: `/app/tasks/${d.taskId}`,
      actions: { approve: "אישור התוכנית", reject: null },
    }));
}

async function summaries(s: Scope): Promise<ApprovalItem[]> {
  const ids = s.clients.filter((c) => s.manager || c.accountManagerId === s.user.id).map((c) => c.id);
  if (ids.length === 0) return [];
  const rows = await prisma.portalSummary.findMany({ where: { status: "DRAFT", clientId: { in: ids } }, include: { client: { select: { name: true } } } });
  return rows.map((x) => ({
    kind: "summary",
    id: x.id,
    clientId: x.clientId,
    clientName: x.client.name,
    title: `סיכום ${month(x.periodStart)}`,
    detail: clip(x.draft),
    since: x.generatedAt,
    by: null,
    href: `/app/clients/${x.clientId}#portal-summary`,
    actions: { approve: "אישור לפורטל", reject: { label: "ביטול הטיוטה", note: false } },
  }));
}

async function guides(s: Scope): Promise<ApprovalItem[]> {
  if (!s.manager) return [];
  const current = await prisma.extractionGuide.findFirst({ where: { state: "APPROVED" }, orderBy: { version: "desc" }, select: { version: true } });
  // approveGuide refuses a draft older than the version in use.
  const rows = await prisma.extractionGuide.findMany({ where: { state: "DRAFT", version: { gt: current?.version ?? 0 } }, orderBy: { version: "asc" } });
  const names = await namesOf(rows.map((r) => r.createdById));
  return rows.map((g) => ({
    kind: "guide",
    id: g.id,
    clientId: null,
    clientName: null,
    title: `הנחיות החילוץ, גרסה ${g.version}`,
    detail: g.note ? clip(g.note) : null,
    since: g.createdAt,
    by: names.get(g.createdById ?? "") ?? null,
    href: "/app/extraction-guide",
    actions: { approve: "אישור הגרסה", reject: { label: "דחייה", note: true } },
  }));
}

/// Every approval waiting on this person. A source that fails is left out
/// and logged: a broken table is a shorter list, not a broken screen.
export async function collectApprovals(user: User): Promise<ApprovalItem[]> {
  const s = await scopeOf(user);
  const parts = await Promise.all(
    [tasks, exceptions, rules, procedures, knowledge, plans, summaries, guides].map((read) =>
      read(s).catch((e: unknown) => {
        console.error(`approvals: ${read.name} failed`, e);
        return [] as ApprovalItem[];
      })
    )
  );
  return parts.flat();
}

/// The number beside "אישורים" in the menu and in the morning email. The
/// knowledge part is the count the review screen has always shown, a
/// meeting waiting for its client counting as one.
export async function countApprovals(user: User): Promise<number> {
  if (!can(user.role, "time_entry.create_self")) return 0;
  const [items, proposals] = await Promise.all([collectApprovals(user), countPendingProposals(user)]);
  return tabCounts(items, [], proposals).all;
}

/// Per client, for the link on the client's page.
export async function countApprovalsForClient(user: User, clientId: string): Promise<number> {
  const items = (await collectApprovals(user)).filter((i) => i.clientId === clientId);
  return items.reduce((n, i) => n + (i.weight ?? 1), 0);
}

// ---------------------------------------------------------------------------
// "לבדיקה": things to check, not to approve.
// ---------------------------------------------------------------------------

const AGREEMENT_LABELS: Record<string, string> = { CONFIDENTIALITY: "התחייבות לסודיות", DELETION_DECLARATION: "הצהרת מחיקה" };

/// What is not yet confirmed with the client, the procedures marked for
/// review, the lessons from runs, the meetings waiting for their client
/// and the signed PDFs waiting to be checked. A manager sees every client;
/// anyone else, what they own and the clients they manage.
export async function collectReview(user: User): Promise<ReviewItem[]> {
  const s = await scopeOf(user);
  if (s.clients.length === 0) return [];
  const ids = s.clients.map((c) => c.id);
  const managed = new Set(s.clients.filter((c) => c.accountManagerId === user.id).map((c) => c.id));
  const name = new Map(s.clients.map((c) => [c.id, c.name]));
  const theirs = <T extends { clientId: string; ownerId: string | null }>(rows: T[]) => (s.manager ? rows : rows.filter((r) => r.ownerId === user.id || managed.has(r.clientId)));

  const unsure = { deletedAt: null, clientId: { in: ids }, knowledgeStatus: { in: ["UNCERTAIN" as const, "MISSING" as const] } };
  const base = { id: true, clientId: true, ownerId: true, toResolve: true, updatedAt: true, knowledgeStatus: true } as const;

  const read = async <T>(label: string, p: Promise<T[]>): Promise<T[]> =>
    p.catch((e: unknown) => {
      console.error(`approvals review: ${label} failed`, e);
      return [] as T[];
    });

  const [facts, contacts, orgs, systems, entities, requestTypes, processes, policies, flagged, lessons, awaiting, signatures, scheduled, lowered, covered] = await Promise.all([
    read("facts", prisma.clientFact.findMany({ where: { ...unsure, kind: { not: "QUESTION" } }, select: { ...base, body: true } })),
    read("contacts", prisma.clientContact.findMany({ where: unsure, select: { ...base, role: true, person: { select: { name: true } } } })),
    read("orgs", prisma.clientOrganization.findMany({ where: unsure, select: { ...base, organization: { select: { name: true } } } })),
    read("systems", prisma.systemAccess.findMany({ where: unsure, select: { ...base, systemName: true } })),
    read("entities", prisma.clientEntity.findMany({ where: unsure, select: { ...base, name: true } })),
    read("requestTypes", prisma.requestType.findMany({ where: unsure, select: { ...base, title: true } })),
    read("processes", prisma.process.findMany({ where: { ...unsure, status: { not: "RETIRED" } }, select: { ...base, code: true, title: true } })),
    read("policies", prisma.clientPolicy.findMany({ where: { ...unsure, status: { not: "RETIRED" } }, select: { ...base, title: true } })),
    read(
      "process review",
      prisma.process.findMany({
        where: { deletedAt: null, clientId: { in: ids }, needsReview: true, status: { not: "RETIRED" } },
        select: { id: true, clientId: true, ownerId: true, code: true, title: true, reviewReason: true, updatedAt: true },
      })
    ),
    read(
      "lessons",
      prisma.processLesson.findMany({
        where: { status: "OPEN", clientId: { in: ids } },
        select: { id: true, clientId: true, body: true, createdAt: true, processId: true, process: { select: { code: true, title: true, ownerId: true } } },
      })
    ),
    read("awaiting assignment", listAwaitingAssignment(user)),
    // Agreement uploads are reviewed by an admin (assertAgreementAdmin).
    user.role === "SUPER_ADMIN" || user.role === "ANKORA_ADMIN"
      ? read(
          "signatures",
          prisma.agreementSignLink.findMany({
            where: { purpose: "PDF_UPLOAD", documentId: { not: null }, reviewedAt: null },
            select: { id: true, userId: true, kind: true, usedAt: true, createdAt: true, user: { select: { name: true } } },
          })
        )
      : Promise.resolve([]),
    // 21.10.2026: an approved process that runs by a date, with none ahead.
    read(
      "scheduled without a date",
      prisma.process.findMany({
        where: { deletedAt: null, clientId: { in: ids }, status: "ACTIVE", triggerKinds: { has: "SCHEDULED" } },
        select: { id: true, clientId: true, ownerId: true, code: true, title: true, updatedAt: true, dates: { where: { deletedAt: null, status: { not: "ARCHIVED" }, nextOccurrenceAt: { not: null } }, select: { id: true } } },
      })
    ),
    // Sources whose items are uncertain only because Ankora wrote them, for
    // the managers who may confirm them with the client in one step.
    s.manager ? read("lowered by source", loweredBySource(ids)) : Promise.resolve([]),
    // Open tasks an approved process covers.
    read("covered tasks", coveredTasksForClients(s.manager ? ids : [...managed])),
  ]);

  const out: ReviewItem[] = [];
  const unsureRow = (r: { id: string; clientId: string; toResolve: string | null; updatedAt: Date; knowledgeStatus: string }, title: string, what: string) => {
    out.push({
      kind: "uncertain",
      id: r.id,
      clientId: r.clientId,
      clientName: name.get(r.clientId) ?? null,
      title: clip(title, 140),
      detail: [what, r.knowledgeStatus === "MISSING" ? "חסר" : "לא ודאי", r.toResolve ? `מה יסגור: ${r.toResolve}` : null].filter(Boolean).join(" · "),
      since: r.updatedAt,
      href: itemHref(r.clientId, r.id),
    });
  };
  for (const r of theirs(facts)) unsureRow(r, r.body, "פריט");
  for (const r of theirs(contacts)) unsureRow(r, r.person.name ?? r.role ?? "איש קשר", "איש קשר");
  for (const r of theirs(orgs)) unsureRow(r, r.organization.name, "ארגון");
  for (const r of theirs(systems)) unsureRow(r, r.systemName, "מערכת");
  for (const r of theirs(entities)) unsureRow(r, r.name, "ישות");
  for (const r of theirs(requestTypes)) unsureRow(r, r.title, "סוג פנייה");
  for (const r of theirs(processes)) unsureRow(r, `${r.code} ${r.title}`, "תהליך");
  for (const r of theirs(policies)) unsureRow(r, r.title, "כלל");

  for (const p of theirs(flagged)) {
    const reason = readReviewReason(p.reviewReason);
    out.push({
      kind: "process_review",
      id: p.id,
      clientId: p.clientId,
      clientName: name.get(p.clientId) ?? null,
      title: `${p.code} ${p.title}`,
      detail: reason ? REVIEW_REASON_LABELS[reason] : "סומן לסקירה",
      since: p.updatedAt,
      href: itemHref(p.clientId, p.id),
    });
  }
  for (const l of lessons) {
    if (!s.manager && l.process.ownerId !== user.id) continue;
    out.push({
      kind: "lesson",
      id: l.id,
      clientId: l.clientId,
      clientName: name.get(l.clientId) ?? null,
      title: `${l.process.code} ${l.process.title}`,
      detail: l.body ? clip(l.body) : "הערה מריצה של התהליך",
      since: l.createdAt,
      href: itemHref(l.clientId, l.processId),
    });
  }
  for (const p of theirs(scheduled)) {
    if (p.dates.length > 0) continue;
    out.push({
      kind: "no_next_date",
      id: p.id,
      clientId: p.clientId,
      clientName: name.get(p.clientId) ?? null,
      title: `${p.code} ${p.title}`,
      detail: `${SCHEDULED_NO_DATE_NOTE}. מקשרים לתהליך את המועדים שלו.`,
      since: p.updatedAt,
      href: itemHref(p.clientId, p.id),
    });
  }
  for (const l of lowered) {
    out.push({
      kind: "source_confirm",
      id: `${l.clientId}:${l.code}`,
      clientId: l.clientId,
      clientName: name.get(l.clientId) ?? null,
      title: `${l.code} ${l.title}`,
      detail: `${l.count === 1 ? "פריט אחד לא ודאי" : `${l.count} פריטים לא ודאיים`} רק כי המקור הוא מסמך של אנקורה. אם הלקוח אישר, "אושר מול הלקוח" במרשם המקורות מאשר את כולם יחד.`,
      since: new Date(),
      href: `/app/clients/${l.clientId}?tab=file#source-${l.code}`,
    });
  }
  for (const c of covered) {
    out.push({
      kind: "covered_task",
      id: c.task.id,
      clientId: c.clientId,
      clientName: name.get(c.clientId) ?? null,
      title: c.task.title,
      detail: `${c.process.code} ${c.process.title} כבר מכסה את העבודה הזו, וכל ריצה שלו פותחת משימה משלה. סוגרים אותה בתהליך.`,
      since: c.task.createdAt,
      href: itemHref(c.clientId, c.process.id),
    });
  }
  for (const a of awaiting) {
    out.push({
      kind: "assignment",
      id: a.id,
      clientId: null,
      clientName: null,
      title: a.source.title,
      detail: "שיחה שמחכה שיגידו של איזה לקוח היא. עד אז שום דבר ממנה לא נכנס לתיק.",
      since: a.createdAt,
      href: approvalsHref("knowledge", null),
    });
  }
  for (const x of signatures) {
    out.push({
      kind: "signature",
      id: x.id,
      clientId: null,
      clientName: null,
      title: `${AGREEMENT_LABELS[x.kind] ?? "מסמך"} של ${x.user.name}`,
      detail: "PDF חתום שהועלה ומחכה לבדיקה. בודקים אותו עם Claude, שרושם את החתימה או מחזיר את הקובץ.",
      since: x.usedAt ?? x.createdAt,
      href: `/app/users/${x.userId}`,
    });
  }
  return out;
}
