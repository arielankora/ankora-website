import "server-only";
import { readinessLabel } from "@/lib/process-readiness";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canSendToAi } from "@/lib/knowledge";
import { listProcesses } from "@/lib/app-domain/processes";
import { listClientPolicies } from "@/lib/app-domain/client-policies";
import { listOpenExceptions } from "@/lib/app-domain/policy-exceptions";
import { ACTION_TAG_LABELS, FIELD_LABELS, HUMAN_ONLY_TAGS, HUMAN_REVIEWED_TAGS, STEP_MODE_LABELS, TRANSITION_LABELS, TRIGGER_LABELS, type ProcessStep } from "@/lib/process-rules";
import { POLICY_KIND_LABELS, ruleDatesLine, ruleInForce } from "@/lib/client-policies";
import { paramsInForce, paramsSummary } from "@/lib/policy-params";
import { readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { BUSINESS_CALENDAR_LABELS } from "@/lib/business-calendar";
import { calendarOfProcess } from "@/lib/app-domain/date-calendars";

// Org brain (claude/org-brain-spec-2026-10-12.md, 8): a client's processes
// and rules, for Claude.
//
// get_client_file already carries both, as prose. These are the same rows
// as data, for a model that is about to act: which procedure to follow,
// step by step, and which rules bind it. Built from the same list
// functions the screens use, then filtered with canSendToAi, so they never
// say more than the client file's version for Claude does: nothing
// sensitive, and nothing restricted unless the person asking is named on
// it.

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

type Processes = Awaited<ReturnType<typeof listProcesses>>;

async function namesFor(processes: Processes, clientId: string) {
  const userIds = [...new Set(processes.flatMap((p) => [p.ownerId, p.backupOwnerId, p.approverUserId]).filter((x): x is string => !!x))];
  const [users, systems] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.systemAccess.findMany({ where: { clientId, deletedAt: null }, select: { id: true, systemName: true } }),
  ]);
  return { user: new Map(users.map((u) => [u.id, u.name])), system: new Map(systems.map((s) => [s.id, s.systemName])) };
}

function summary(p: Processes[number], user: Map<string, string>) {
  const reason = readReviewReason(p.reviewReason);
  return {
    code: p.code,
    title: p.title,
    purpose: p.purpose,
    status: p.status,
    triggers: p.triggerKinds.map((t) => TRIGGER_LABELS[t]),
    trigger: p.triggerText,
    owner: p.ownerId ? (user.get(p.ownerId) ?? null) : null,
    backup: p.backupOwnerId ? (user.get(p.backupOwnerId) ?? null) : null,
    handover: TRANSITION_LABELS[p.transitionStatus],
    // 25.10.2026: whether it runs, and how well it is written down.
    runs: readinessLabel(p.readiness),
    documentation: `${p.documentation.score}/${p.documentation.of}`,
    notApplicable: p.notApplicable.length ? p.notApplicable.map((k) => FIELD_LABELS[k]) : null,
    needsReview: reason ? REVIEW_REASON_LABELS[reason] : null,
    approvedVersion: p.current?.version ?? null,
    nextDate: day(p.nextDate),
    lastRun: day(p.lastRunAt),
    // Spec 6.1: shown with the item everywhere, Claude included.
    doNotDisclose: p.doNotDisclose,
  };
}

const visible = (actor: User) => (r: Parameters<typeof canSendToAi>[0]) => canSendToAi(r, actor.id);

export async function mcpListProcesses(actor: User, clientId: string) {
  const processes = (await listProcesses(actor, clientId)).filter(visible(actor));
  const { user } = await namesFor(processes, clientId);
  return processes.map((p) => summary(p, user));
}

/// One process in full: everything list_processes says, the approved
/// procedure step by step, what it is missing, what it fails among the
/// client's rules today, and its last runs.
export async function mcpGetProcess(actor: User, clientId: string, processId: string) {
  const p = (await listProcesses(actor, clientId)).filter(visible(actor)).find((x) => x.id === processId);
  if (!p) return null;
  const { user, system } = await namesFor([p], clientId);
  const step = (s: ProcessStep, i: number) => ({
    n: i + 1,
    title: s.title,
    mode: STEP_MODE_LABELS[s.mode],
    businessDay: s.offsetBusinessDays,
    actions: s.actionTags.map((t) => ACTION_TAG_LABELS[t]),
    systems: s.systemIds.map((id) => system.get(id) ?? "מערכת שהוסרה"),
    output: s.output,
    verification: s.verification,
    needsApproval: s.requiresApproval,
    amountMax: s.amountMaxMinor !== null ? `${(s.amountMaxMinor / 100).toLocaleString("en-US")} ${s.currency ?? ""}`.trim() : null,
    channel: s.channel,
  });
  const runs = await prisma.task.findMany({
    // 28.10.2026: a run marked "בלי AI" is not listed to Claude.
    where: { processId: p.id, parentId: null, deletedAt: null, aiExcluded: false },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, title: true, status: true, dueDate: true },
  });
  return {
    ...summary(p, user),
    sla: p.slaText,
    // Decision 6: business days are counted on this calendar, for its
    // steps and for the dates that start it.
    businessDays: await (async () => {
      const c = await calendarOfProcess(p);
      return c ? BUSINESS_CALENDAR_LABELS[c.key] : "לפי לוח המועד (ברירת מחדל: ישראל)";
    })(),
    executorToday: p.executorUserId ? (user.get(p.executorUserId) ?? p.executorText) : p.executorText,
    // Spec 3.9: what each system it needs must let us do.
    systemPermissions: await (async () => {
      const perms = (p.requiredSystemPermissions ?? {}) as Record<string, unknown>;
      const ids = Object.keys(perms).filter((id) => p.requiredSystemIds.includes(id) && typeof perms[id] === "string");
      if (!ids.length) return [];
      const rows = await prisma.systemAccess.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, systemName: true } });
      return rows.map((r) => ({ system: r.systemName, permission: perms[r.id] as string }));
    })(),
    // Who signs an approval step: at Ankora in the product, at the client
    // by name (a contact Claude may not see is not named).
    approver: await (async () => {
      const contact = p.approverContactId
        ? await prisma.clientContact.findFirst({ where: { id: p.approverContactId, deletedAt: null }, select: { role: true, sensitivity: true, audience: true, audienceUserIds: true, person: { select: { name: true } } } })
        : null;
      return {
        atAnkora: p.approverUserId ? (user.get(p.approverUserId) ?? null) : null,
        atClient: contact && canSendToAi(contact, actor.id) ? (contact.person.name ?? contact.role) : null,
        inWords: p.approverText,
      };
    })(),
    approvals: p.approvalText,
    externalParty: p.externalPartyText,
    exceptionPlaybook: p.exceptionPlaybook,
    gaps: p.gaps,
    procedure: p.current
      ? {
          version: p.current.version,
          steps: p.current.steps.map(step),
          highlights: p.current.highlights,
          outputs: p.current.outputs,
          failsRules: p.current.checks.filter((c) => !c.excepted).map((c) => c.message),
        }
      : null,
    draftVersion: p.draft?.version ?? null,
    recentRuns: runs.map((r) => ({ taskId: r.id, title: r.title, status: r.status, due: day(r.dueDate) })),
    // Spec 5.4: what people who closed runs said, still waiting for the
    // next version. Read them before drafting one.
    openLessons: (await prisma.processLesson.findMany({ where: { processId: p.id, status: "OPEN" }, orderBy: { createdAt: "asc" }, select: { body: true, version: true, createdAt: true } })).map((l) => ({
      lesson: l.body,
      fromVersion: l.version,
      on: day(l.createdAt),
    })),
  };
}

/// The rules that bind work for a client: Ankora's own, which are in code
/// and the same for every client, then the client's, as they apply today.
export async function mcpListPolicies(actor: User, clientId: string) {
  const [rules, exceptions, entities] = await Promise.all([
    listClientPolicies(actor, clientId),
    listOpenExceptions(actor, clientId),
    prisma.clientEntity.findMany({ where: { clientId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const now = new Date();
  return {
    ankora: [
      `לא נעשה אוטומטית, ואדם מאשר כש-Claude מכין: ${HUMAN_ONLY_TAGS.map((t) => ACTION_TAG_LABELS[t]).join(", ")}.`,
      `${HUMAN_REVIEWED_TAGS.map((t) => ACTION_TAG_LABELS[t]).join(", ")}: אדם בודק לפני שזה יוצא.`,
      "שלב אוטומטי חייב דרך שבה אדם מוודא שהוא קרה.",
      "אין סיסמאות, קודים או מספרי כרטיס בשיחה, בתיק או בנוהל.",
    ],
    clientRules: rules
      .filter((r) => r.status !== "RETIRED")
      .filter(visible(actor))
      .map((r) => {
        const inForce = ruleInForce(r)!;
        return {
          kind: POLICY_KIND_LABELS[r.kind],
          title: r.title,
          rule: inForce.text,
          status: inForce.startsOn ? "נכנס לתוקף בהמשך: לא חל עדיין" : r.status === "ACTIVE" ? "בתוקף" : inForce.interim ? "מוצע: חל כלל הביניים" : "מוצע",
          // Spec 3.11: when it starts to bind, and when it is reviewed.
          dates: ruleDatesLine(r),
          proposedRule: r.status === "PROPOSED" && inForce.interim ? r.statement : null,
          checkedAgainstProcedures: paramsSummary(r.kind, paramsInForce(r), (id) => entityName.get(id) ?? "ישות שהוסרה"),
          rationale: r.rationale,
          doNotDisclose: r.doNotDisclose,
          exceptions: exceptions
            .filter((e) => e.policyId === r.id && e.status === "APPROVED" && e.validUntil.getTime() > now.getTime())
            .map((e) => ({ what: e.what, until: day(e.validUntil) })),
        };
      }),
  };
}
