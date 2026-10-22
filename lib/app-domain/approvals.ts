import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { countPendingProposals } from "@/lib/app-domain/knowledge-proposals";
import { sentForApprovalAt } from "@/lib/app-domain/task-approval-times";
import { OPEN_STATUSES } from "@/lib/app-domain/tasks";
import { approvalsHref, tabCounts, type ApprovalItem } from "@/lib/approvals";
import { processDecisions } from "@/lib/app-domain/process-next-steps";
import { nextSteps, type NextStepKind } from "@/lib/next-steps";
import { processChecks, ruleContext } from "@/lib/app-domain/processes";
import { readSteps } from "@/lib/process-rules";
import { canSeeKnowledgeItem } from "@/lib/knowledge";
import { planPreview, procedurePreview, rulePreview } from "@/lib/approvals-preview";

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
      dueDate: true,
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
    recommend: { text: "לבדוק את התוצאה, לאשר ולסגור", why: `${t.assignedTo?.name ?? "מי שביצע"} סיים ושלח לחתימה שלך, והמשימה לא נסגרת עד שתאשר.` },
    deadline: t.dueDate,
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
    recommend: { text: "לאשר אם הסיבה מספיקה", why: `החריגה מוגבלת עד ${day(e.validUntil)}, ואחר כך חוזרים לכלל.` },
    deadline: e.validUntil,
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
      // The whole rule, when the line above cuts it or there is more.
      preview: p.statement.replace(/\s+/g, " ").trim().length > 220 || p.interimStatement || p.rationale ? rulePreview(p) : null,
      since: p.createdAt,
      by: names.get(p.createdById ?? "") ?? null,
      href: itemHref(p.clientId, p.id),
      // approveClientPolicy refuses a rule that is not yet confirmed, so
      // the row says what would confirm it instead of offering a button.
      blocked: confirmed ? null : `צריך אימות מול הלקוח${p.toResolve ? `: ${p.toResolve}` : "."}`,
      actions: { approve: confirmed ? "אישור הכלל" : null, reject: { label: "הסרה", note: false } },
      recommend: confirmed
        ? { text: "לאשר", why: p.interimStatement ? "הלקוח אמר את זה במפורש. עד האישור חל כלל הביניים, ואחריו הכלל עצמו נבדק מול כל נוהל ומשימה." : "הלקוח אמר את זה במפורש. מאושר, הוא נבדק מול כל נוהל ומשימה." }
        : { text: "לשאול את הלקוח, ואז לאשר", why: "כלל שלא אומת לא מאושר." },
    };
  });
}

async function procedures(s: Scope): Promise<ApprovalItem[]> {
  if (!s.manager || s.clients.length === 0) return [];
  const drafts = await prisma.processVersion.findMany({
    where: { status: "DRAFT", process: { deletedAt: null, status: { not: "RETIRED" }, clientId: { in: s.clients.map((c) => c.id) } } },
    include: {
      process: { select: { id: true, code: true, title: true, clientId: true, entityId: true, externalPartyContactIds: true, client: { select: { name: true } } } },
    },
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
  // The same checks approveProcessVersion runs, read once per client, so
  // the row says what holds it back instead of a button that fails.
  const clientIds = [...new Set(current.map((d) => d.process.clientId))];
  const viewer = { id: s.user.id, isManager: s.manager };
  const [contexts, systems] = await Promise.all([
    Promise.all(
      clientIds.map(async (id) => {
        const am = s.clients.find((c) => c.id === id)?.accountManagerId ?? null;
        return [id, await ruleContext(id, { canSee: (r) => canSeeKnowledgeItem(r, viewer, am) })] as const;
      })
    ).then((rows) => new Map(rows)),
    prisma.systemAccess
      .findMany({ where: { clientId: { in: clientIds }, deletedAt: null }, select: { id: true, systemName: true } })
      .then((rows) => Object.fromEntries(rows.map((r) => [r.id, r.systemName]))),
  ]);
  return current.map((d) => {
    const steps = readSteps(d.steps);
    const checks = processChecks({ steps, highlights: d.highlights, outputs: d.outputs }, d.process, contexts.get(d.process.clientId)!);
    const preview = procedurePreview({ steps, highlights: d.highlights, outputs: d.outputs }, systems, checks);
    const held = preview.problems.length > 0;
    return {
      kind: "procedure",
      id: d.processId,
      version: d.version,
      clientId: d.process.clientId,
      clientName: d.process.client.name,
      title: `${d.process.code} ${d.process.title}`,
      detail: `${d.changeNote ? `גרסה ${d.version}: ${clip(d.changeNote)}` : `גרסה ${d.version} של הנוהל`} · ${steps.length === 1 ? "שלב אחד" : `${steps.length} שלבים`}`,
      since: d.createdAt,
      by: names.get(d.createdById ?? "") ?? null,
      href: itemHref(d.process.clientId, d.processId),
      preview,
      blocked: held ? "הנוהל לא עובר את הבדיקות. מתקנים אותו בתהליך, ואז מאשרים." : null,
      actions: { approve: held ? null : "אישור הנוהל", reject: null },
      recommend: held ? { text: "לתקן בתהליך, ואז לאשר", why: "נוהל שלא עומד בכללים של הלקוח לא מאושר." } : { text: "לקרוא ולאשר", why: "עובר את כל הבדיקות מול הכללים של הלקוח. בלי נוהל מאושר התהליך לא פותח ריצות." },
      // Waiting on this is waiting with the work: no run opens without it.
      blocking: !held,
    };
  });
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
      recommend: { text: "לעבור על ההצעות", why: "כל הצעה נכנסת לתיק רק אחרי אישור, עם המקור שלה." },
      go: { label: "לעבור", href: approvalsHref("knowledge", b.clientId) },
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
    include: { task: { select: { id: true, title: true, clientId: true, dueDate: true, client: { select: { name: true } } } }, createdBy: { select: { name: true } } },
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
      preview: planPreview({ body: d.body, steps: d.steps }),
      since: d.createdAt,
      by: d.createdBy?.name ?? (d.origin === "APP" ? null : "Claude"),
      href: `/app/tasks/${d.taskId}`,
      actions: { approve: "אישור התוכנית", reject: null },
      recommend: { text: "לקרוא ולאשר", why: "מי שמבצע את המשימה מחכה לתוכנית מאושרת כדי להתחיל." },
      deadline: d.task.dueDate,
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
    recommend: { text: "לקרוא ולאשר לפורטל", why: "הלקוח יראה את הסיכום בפורטל רק אחרי האישור." },
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
    recommend: { text: "לקרוא את השינוי ולאשר", why: "ההנחיות קובעות מה Claude מחלץ מכל פגישה, מעכשיו." },
  }));
}

/// The steps of a process that are decisions, on the approvals screen. The
/// rest (a draft, fields to fill, access, an item not yet confirmed) are
/// on the process itself and in "שאלות ללקוח".
const DECISION_STEPS: NextStepKind[] = ["no_next_date", "review", "covered_tasks", "backup", "lessons"];

/// A process's decisions: for a manager, every process of their clients;
/// for anyone else, the processes they own (22.10.2026).
async function processes(s: Scope): Promise<ApprovalItem[]> {
  if (s.clients.length === 0) return [];
  const name = new Map(s.clients.map((c) => [c.id, c.name]));
  const rows = await processDecisions(
    s.clients.map((c) => c.id),
    (p) => s.manager || p.ownerId === s.user.id
  );
  const out: ApprovalItem[] = [];
  for (const r of rows) {
    const href = itemHref(r.clientId, r.facts.id);
    for (const step of nextSteps(r.facts, s.manager)) {
      if (!DECISION_STEPS.includes(step.kind)) continue;
      // A process not yet approved, without dates, stops nothing yet: its
      // dates are part of writing it, on the process.
      if (step.kind === "no_next_date" && !step.blocking) continue;
      out.push({
        kind: "process",
        id: `${r.facts.id}:${step.kind}`,
        clientId: r.clientId,
        clientName: name.get(r.clientId) ?? null,
        title: `${r.facts.code} ${r.facts.title}`,
        detail: step.title,
        since: r.updatedAt,
        by: null,
        href,
        actions: { approve: step.fix.kind === "op" ? step.fix.label : null, reject: null },
        recommend: step.recommend ? { text: step.recommend, why: step.why } : null,
        op: step.fix.kind === "op" ? step.fix.op : null,
        go: step.fix.kind === "op" ? null : { label: step.fix.label, href },
        blocking: step.blocking,
        deadline: r.deadline,
      });
    }
  }
  return out;
}

const AGREEMENT_LABELS: Record<string, string> = { CONFIDENTIALITY: "התחייבות לסודיות", DELETION_DECLARATION: "הצהרת מחיקה" };

/// Signed PDFs waiting to be checked, for an admin (assertAgreementAdmin).
async function checks(s: Scope): Promise<ApprovalItem[]> {
  if (s.user.role !== "SUPER_ADMIN" && s.user.role !== "ANKORA_ADMIN") return [];
  const rows = await prisma.agreementSignLink.findMany({
    where: { purpose: "PDF_UPLOAD", documentId: { not: null }, reviewedAt: null },
    select: { id: true, userId: true, kind: true, usedAt: true, createdAt: true, user: { select: { name: true } } },
  });
  return rows.map((x) => ({
    kind: "check",
    id: x.id,
    clientId: null,
    clientName: null,
    title: `${AGREEMENT_LABELS[x.kind] ?? "מסמך"} של ${x.user.name}`,
    detail: "PDF חתום שהועלה ומחכה לבדיקה.",
    since: x.usedAt ?? x.createdAt,
    by: x.user.name,
    href: `/app/users/${x.userId}`,
    actions: { approve: null, reject: null },
    recommend: { text: "לבדוק עם Claude", why: "Claude קורא את הקובץ, ורושם את החתימה או מחזיר אותו עם סיבה." },
    go: { label: "לבדיקה", href: `/app/users/${x.userId}` },
  }));
}

/// Every approval waiting on this person. A source that fails is left out
/// and logged: a broken table is a shorter list, not a broken screen.
export async function collectApprovals(user: User): Promise<ApprovalItem[]> {
  const s = await scopeOf(user);
  const parts = await Promise.all(
    [tasks, exceptions, rules, procedures, processes, knowledge, plans, summaries, guides, checks].map((read) =>
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
  return tabCounts(items, 0, proposals).all;
}

/// Per client, for the link on the client's page.
export async function countApprovalsForClient(user: User, clientId: string): Promise<number> {
  const items = (await collectApprovals(user)).filter((i) => i.clientId === clientId);
  return items.reduce((n, i) => n + (i.weight ?? 1), 0);
}
