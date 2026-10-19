import "server-only";
import { prisma } from "@/lib/prisma";
import { RECEIPT_LABEL } from "@/lib/date-receipt";
import { assertCan } from "@/lib/app-auth/permissions";
import { canSendToAi, effectiveStatus, parseFieldStatus, type KnowledgeAudienceLike } from "@/lib/knowledge";
import { formatSourceRef, readSourceRefs, SOURCE_KIND_LABELS, SOURCE_WEIGHT_LABELS } from "@/lib/knowledge-sources";
import { FACT_TOPIC_LABELS, isPastValidity, type FactTopicLike } from "@/lib/client-facts";
import { SYSTEM_ACCESS_STATUS_LABELS, SYSTEM_PERMISSION_LABELS } from "@/lib/system-map";
import { formatMinor } from "@/lib/money";
import type { ClientFileDoc, DocItem, DocSection } from "@/lib/client-file-document";
import { assertClientAccess, listClientSources } from "@/lib/app-domain/client-sources";
import { listClientPeople } from "@/lib/app-domain/client-contacts";
import { listClientFacts } from "@/lib/app-domain/client-facts";
import { listSystemMap } from "@/lib/app-domain/system-map";
import { listClientEntities } from "@/lib/app-domain/client-entities";
import { listImportantDates } from "@/lib/app-domain/important-dates";
import { listRequestTypes } from "@/lib/app-domain/request-types";
import { listNarratives } from "@/lib/app-domain/client-narratives";
import { listClientPolicies } from "@/lib/app-domain/client-policies";
import { listOpenExceptions } from "@/lib/app-domain/policy-exceptions";
import { listProcesses, ruleWarnings } from "@/lib/app-domain/processes";
import { daysSinceLastBatch } from "@/lib/app-domain/client-control";
import { controlFrom, controlParts } from "@/lib/client-control";
import { batchItem, CHANGES_GROUP, oneOffSuppliers, ruleSection } from "@/lib/client-file-sections";
import { paramsInForce, paramsSummary } from "@/lib/policy-params";
import { readReviewReason, REVIEW_REASON_LABELS } from "@/lib/process-review";
import { STEP_MODE_LABELS, TRANSITION_LABELS, TRIGGER_LABELS } from "@/lib/process-rules";
import { checkEveryText } from "@/lib/process-checks";
import { POLICY_KIND_LABELS, POLICY_STATUS_LABELS, ruleDatesLine, ruleInForce } from "@/lib/client-policies";
import { ACTION_LABEL } from "@/app/(product)/app/(authenticated)/audit-log/labels";
import { refLabel, teamRefs } from "@/lib/external-refs";
import type { User, ClientFact, KnowledgeSensitivity } from "@prisma/client";

// Org brain, phase 2: the client file as one document
// (claude/org-brain-spec-2026-10-12.md, 6.1 and 6.3).
//
// Nothing here is stored. The document is assembled from the file's
// tables each time it is read, through the same list functions the
// screens use, so it can never show what the screen would hide: each
// item's audience is applied before it gets here.
//
// The "ai" version is what Claude receives (spec 6.3): no emails, phones,
// card digits or vault names, nothing marked sensitive, and nothing
// restricted unless the person asking is named on it (canSendToAi).

const RELATIONSHIP: Record<string, string> = {
  CLIENT_STAFF: "צוות הלקוח",
  PROVIDER: "נותן שירות",
  ADVISOR: "יועץ",
  INVESTOR: "משקיע",
  SUPPLIER: "ספק",
  ANKORA: "אנקורה",
};

/// The entity types whose changes make up section 16.
const FILE_ENTITY_TYPES = ["Process", "PolicyException", "ClientPolicy", "RequestType", "ClientNarrative", "ClientContact", "ClientOrganization", "ClientSource", "ClientDomain", "SystemAccess", "ClientFact", "ClientEntity", "KnowledgeBatch", "KnowledgeProposal"];

function routeNames(ids: string[], names: Map<string, string>): string | null {
  const shown = ids.map((id) => names.get(id)).filter((n): n is string => !!n);
  return shown.length ? `מפנים ל: ${shown.join(", ")}` : null;
}

function day(d: Date | null | undefined): string | null {
  return d ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d) : null;
}

function knowledge(row: { knowledgeStatus: DocItem["status"]; fieldStatus: unknown; toResolve: string | null; sources: unknown; doNotDisclose: string | null; clientVisible?: boolean; ownerId?: string | null; externalRefs?: unknown }): Pick<DocItem, "status" | "toResolve" | "sources" | "doNotDisclose" | "clientVisible" | "owner" | "refs"> {
  return {
    refs: teamRefs(row.externalRefs).map(refLabel),
    status: effectiveStatus(row.knowledgeStatus!, parseFieldStatus(row.fieldStatus)),
    toResolve: row.toResolve,
    sources: readSourceRefs(row.sources).map(formatSourceRef),
    doNotDisclose: row.doNotDisclose,
    clientVisible: row.clientVisible || undefined,
    // An id here; named once, when the document is assembled.
    owner: row.ownerId ?? null,
  };
}

export async function buildClientFile(actor: User, clientId: string, options: { audience: "staff" | "ai" }): Promise<ClientFileDoc> {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const ai = options.audience === "ai";
  const shown = (r: { sensitivity: KnowledgeSensitivity; audience: KnowledgeAudienceLike; audienceUserIds: string[] }) => !ai || canSendToAi(r, actor.id);

  const [client, entities, people, facts, systems, sources, dates, audit, requestTypes, narratives, policies, exceptions, processes, warnings, daysSinceBatch, supplierTasks, openLessons, batches] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, legalName: true, kind: true, industry: true } }),
    listClientEntities(actor, clientId),
    listClientPeople(actor, clientId),
    listClientFacts(actor, clientId),
    listSystemMap(actor, clientId),
    listClientSources(actor, clientId),
    listImportantDates(actor, { clientId }),
    prisma.auditEvent.findMany({
      where: { clientId, entityType: { in: FILE_ENTITY_TYPES } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { action: true, createdAt: true, actor: { select: { name: true } } },
    }),
    listRequestTypes(actor, clientId),
    listNarratives(actor, clientId),
    listClientPolicies(actor, clientId),
    listOpenExceptions(actor, clientId),
    listProcesses(actor, clientId),
    ruleWarnings(actor, clientId),
    daysSinceLastBatch(clientId),
    // Section 7.2: suppliers named on the client's tasks (decision 2).
    prisma.task.findMany({
      where: { clientId, deletedAt: null, parentId: null, supplierName: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { title: true, supplierName: true, supplierExperience: true, supplierRecordedAt: true, createdAt: true },
    }),
    // Section 7.4: remarks from closed runs, waiting for the next version.
    prisma.processLesson.groupBy({ by: ["processId"], where: { clientId, status: "OPEN" }, _count: true }),
    // Section 16: what the extraction delivered, and what became of it.
    prisma.knowledgeBatch.findMany({
      where: { clientId, awaitingAssignment: false },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { createdAt: true, via: true, note: true, sourceId: true, proposals: { select: { state: true } } },
    }),
  ]);
  const ownerIds = [...new Set([...processes.flatMap((p) => [p.ownerId, p.backupOwnerId, p.approverUserId]), ...facts.current.map((f) => f.assigneeId)].filter((x): x is string => !!x))];
  const ownerName = new Map((await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const narrative = (kind: string) => narratives.find((n) => n.kind === kind)?.current?.body ?? null;

  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const contacts = people.contacts.filter(shown);
  const orgs = people.organizations.filter(shown);
  const current = facts.current.filter(shown);
  const of = (kind: ClientFact["kind"]) => current.filter((f) => f.kind === kind);
  // Names come from the contacts shown here, never from the request type's
  // own lookup, so a contact hidden from this version is not named either.
  const contactName = new Map(contacts.map((c) => [c.id, c.person.name ?? c.role ?? ""]));
  const subjectName = new Map<string, string>([
    ...contacts.map((c) => [c.id, c.person.name ?? c.role ?? ""] as [string, string]),
    ...orgs.map((o) => [o.id, o.organization.name] as [string, string]),
  ]);
  const now = new Date();

  const factItem = (f: ClientFact): DocItem & { group?: string } => ({
    ref: f.id,
    text: f.body,
    details: [
      f.subjectContactId || f.subjectOrgId ? subjectName.get((f.subjectContactId ?? f.subjectOrgId)!) : null,
      f.referTo ? `מפנים ל: ${f.referTo}` : null,
      f.kind === "TEMPORARY" ? `בתוקף עד ${day(f.validUntil) ?? f.validUntilEvent}` : null,
      f.kind === "TEMPORARY" && isPastValidity(f, now) ? "עבר התוקף, לבדוק שעדיין נכון" : null,
      f.kind === "ONE_OFF_DECISION" ? [day(f.decidedAt), f.decidedBy].filter(Boolean).join(", ") : null,
      f.answer ? `תשובה: ${f.answer}` : null,
      (f.kind === "QUESTION" || f.kind === "TEMPORARY") && f.assigneeId && ownerName.get(f.assigneeId) ? `אחראי: ${ownerName.get(f.assigneeId)}` : null,
      f.taskId ? "יש משימה" : null,
      ...(Array.isArray(f.alternatives) ? (f.alternatives as { value?: unknown; sources?: unknown }[]) : [])
        .filter((a) => typeof a?.value === "string")
        .map((a) => `גרסה אחרת: ${a.value as string}${readSourceRefs(a.sources).length ? ` [${readSourceRefs(a.sources).map(formatSourceRef).join(", ")}]` : ""}`),
      f.importance === "LOW" ? "לא קריטי" : null,
    ],
    ...knowledge(f),
    // A question's status is the question itself; it is not repeated.
    ...(f.kind === "QUESTION" ? { status: f.answeredAt ? f.knowledgeStatus : undefined, toResolve: null } : {}),
    group: f.topic ? FACT_TOPIC_LABELS[f.topic as FactTopicLike] : undefined,
  });

  // Rules in force and proposed; a retired rule is history, read on the
  // screen. A proposed rule says what applies until it is approved.
  const rules = policies.filter((p) => p.status !== "RETIRED").filter(shown);
  const ruleItem = (p: (typeof rules)[number]): DocItem & { group?: string; proposed?: boolean } => {
    const now = ruleInForce(p)!;
    return {
      ref: p.id,
      text: `${p.title}: ${now.text}`,
      details: [
        p.status === "PROPOSED" ? (now.interim ? `${POLICY_STATUS_LABELS.PROPOSED}, זה כלל הביניים. הכלל המוצע: ${p.statement}` : `${POLICY_STATUS_LABELS.PROPOSED}, עוד לא אושר`) : null,
        p.rationale ? `למה: ${p.rationale}` : null,
        // Spec 3.11: when it starts, and when it is looked at again.
        ruleDatesLine(p),
        (() => {
          const checked = paramsSummary(p.kind, paramsInForce(p), (id) => entityName.get(id) ?? "ישות שהוסרה");
          return checked ? `נבדק מול הנהלים: ${checked}` : null;
        })(),
        // An approved exception travels with its rule: whoever reads the
        // rule reads that, until a date, it is done otherwise.
        ...exceptions
          .filter((e) => e.policyId === p.id && e.status === "APPROVED")
          .map((e) => `חריגה מאושרת עד ${day(e.validUntil)}: ${e.what}${e.decidedByName ? `, אישר/ה ${e.decidedByName}` : ""}`),
      ],
      ...knowledge(p),
      group: POLICY_KIND_LABELS[p.kind],
      proposed: p.status === "PROPOSED",
    };
  };
  const rulesIn = (section: ReturnType<typeof ruleSection>) => rules.filter((p) => ruleSection(p.kind) === section).map(ruleItem);

  const primary = contacts.find((c) => c.isPrimary);
  const sections: DocSection[] = [
    {
      number: "1",
      title: "זהות הלקוח",
      empty: "",
      items: [
        { text: client.legalName ? `${client.name} (${client.legalName})` : client.name, details: [client.kind === "PRIVATE" ? "לקוח פרטי" : "לקוח עסקי", client.industry] },
        ...(primary ? [{ text: `איש קשר ראשי: ${primary.person.name ?? primary.role}`, details: [primary.role] }] : []),
        ...entities.filter(shown).map((e) => ({
          ref: e.id,
          text: `ישות: ${e.name}`,
          details: [e.legalName, e.registrationNumber, e.country, e.currency, e.parent ? `בת של ${e.parent.name}` : null],
          ...knowledge(e),
          toResolve: e.toResolve ?? Object.values(parseFieldStatus(e.fieldStatus))[0]?.toResolve ?? null,
        })),
      ],
    },
    {
      number: "2",
      title: "סקירה, רקע ותפקידנו",
      empty: "עוד לא נכתב מה בתחום ומה מחוץ לו.",
      items: [
        ...[
          ["OVERVIEW", "סקירה"],
          ["BACKGROUND", "רקע"],
          ["OUR_ROLE", "התפקיד שלנו"],
        ]
          .filter(([k]) => narrative(k))
          .map(([k, label]) => ({ text: `${label}: ${narrative(k)}` })),
        ...of("SCOPE_IN").map((f) => ({ ...factItem(f), group: "בתחום" })),
        ...of("SCOPE_OUT").map((f) => ({ ...factItem(f), group: "מחוץ לתחום" })),
      ],
    },
    {
      number: "3",
      title: "אנשים ויחסים",
      empty: "אין עדיין אנשי קשר בתיק.",
      items: contacts.map((c) => ({
        ref: c.id,
        text: c.person.name ?? c.role ?? "",
        details: [
          c.person.name ? c.role : null,
          RELATIONSHIP[c.relationship],
          c.person.organization?.name,
          c.entityId ? entityName.get(c.entityId) : null,
          c.isPrimary ? "ראשי" : null,
          c.isDecisionMaker ? "מקבל החלטות" : null,
          ai ? null : [...c.person.emails, ...c.person.phones].join(", ") || null,
          c.context,
        ],
        ...knowledge(c),
      })),
    },
    { number: "4", title: "העדפות", empty: "אין עדיין העדפות.", items: of("PREFERENCE").map(factItem) },
    { number: "5", title: "דרישות חוזרות", empty: "אין עדיין דרישות חוזרות.", items: of("REQUIREMENT").map(factItem) },
    {
      number: "6",
      title: "כללים והגבלות",
      empty: "הלקוח עוד לא קבע כללים.",
      items: rulesIn("6"),
    },
    {
      number: "7.1",
      title: "מערכות וגישות",
      empty: "אין עדיין מערכות במפה.",
      items: systems.filter(shown).map((s) => ({
        ref: s.id,
        text: s.systemName,
        details: [
          s.purpose,
          s.entityId ? entityName.get(s.entityId) : null,
          SYSTEM_ACCESS_STATUS_LABELS[s.accessStatus],
          s.ourPermission !== "NONE" ? `הרשאה: ${SYSTEM_PERMISSION_LABELS[s.ourPermission]}` : null,
          s.accountUsed ? `חשבון: ${s.accountUsed}` : null,
          s.blocker ? `חוסם: ${s.blocker}` : null,
          s.clientAdmin ? `מנהל אצל הלקוח: ${s.clientAdmin}` : null,
          s.billingCostMinor !== null ? (s.billingCurrency === "USD" ? `$${(s.billingCostMinor / 100).toLocaleString("en-US")}` : formatMinor(s.billingCostMinor)) : null,
          !ai && s.cardLast4 ? `כרטיס ****${s.cardLast4}` : null,
          s.invoiceTo ? `חשבונית ל: ${s.invoiceTo}` : null,
          ...(warnings.systems[s.id] ?? []),
        ],
        ...knowledge(s),
      })),
    },
    {
      number: "7.2",
      title: "ספקים ונותני שירות",
      empty: "אין עדיין ספקים או נותני שירות קבועים.",
      items: [
        ...orgs.map((o) => ({
          text: o.organization.name,
          details: [
            o.role,
            RELATIONSHIP[o.relationship],
            o.monthlyCostMinor !== null ? `${o.currency === "USD" ? `$${(o.monthlyCostMinor / 100).toLocaleString("en-US")}` : formatMinor(o.monthlyCostMinor)} בחודש` : null,
            o.notes,
          ],
          ...knowledge(o),
        })),
        // Against every organization of the client, shown or not, so one
        // hidden from this version does not come back as a one-off.
        ...oneOffSuppliers(supplierTasks, people.organizations.map((o) => o.organization.name), day),
      ],
    },
    { number: "7.3", title: "מקורות ידע ומיקומים", empty: "עוד לא נכתב איפה נמצא הידע.", items: of("LOCATION").map(factItem) },
    {
      number: "7.4",
      title: "תהליכים",
      empty: "עוד לא נכתבו תהליכים.",
      // A process reads as one line with everything a person needs to run
      // it: trigger, owner, where it stands, how complete, what is missing,
      // and the steps of the approved procedure.
      items: processes.filter(shown).map((p) => ({
        ref: p.id,
        text: `${p.code} ${p.title}`,
        details: [
          p.purpose,
          [p.triggerKinds.map((t) => TRIGGER_LABELS[t]).join(", "), p.triggerText].filter(Boolean).join(": ") || null,
          p.ownerId ? `בעלים: ${ownerName.get(p.ownerId) ?? ""}` : null,
          p.backupOwnerId ? `מחליף: ${ownerName.get(p.backupOwnerId) ?? ""}` : null,
          TRANSITION_LABELS[p.transitionStatus],
          (() => {
            const who = p.executorUserId ? ownerName.get(p.executorUserId) : p.executorContactId ? contactName.get(p.executorContactId) : null;
            return who || p.executorText ? `מבצע היום: ${who ?? p.executorText}` : null;
          })(),
          (() => {
            const perms = (p.requiredSystemPermissions ?? {}) as Record<string, unknown>;
            const list = p.requiredSystemIds
              .map((id) => {
                const name = systems.find((x) => x.id === id && shown(x))?.systemName;
                return name ? (typeof perms[id] === "string" ? `${name} (${perms[id]})` : name) : null;
              })
              .filter(Boolean);
            return list.length ? `מערכות: ${list.join(", ")}` : null;
          })(),
          p.slaText ? `SLA: ${p.slaText}` : null,
          (() => {
            const who = [p.approverUserId ? ownerName.get(p.approverUserId) : null, p.approverContactId ? contactName.get(p.approverContactId) : null, p.approverText].filter(Boolean);
            return who.length ? `מאשר: ${[...new Set(who)].join(", ")}` : null;
          })(),
          p.nextDate ? `הבא: ${day(p.nextDate)}` : null,
          p.checkEveryDays ? `בדיקה ${checkEveryText(p.checkEveryDays)}${p.checkText ? `: ${p.checkText}` : ""}${p.lastCheckedAt ? `, נבדק לאחרונה ${day(p.lastCheckedAt)}` : ", עוד לא נבדק"}` : null,
          readReviewReason(p.reviewReason) ? `דורש סקירה: ${REVIEW_REASON_LABELS[readReviewReason(p.reviewReason)!]}` : null,
          `שלמות ${p.completeness.score} מתוך 9`,
          (() => {
            const n = openLessons.find((l) => l.processId === p.id)?._count ?? 0;
            return n ? (n === 1 ? "הערה אחת מריצות ממתינה לגרסה הבאה" : `${n} הערות מריצות ממתינות לגרסה הבאה`) : null;
          })(),
          ...p.gaps,
          p.current
            ? `נוהל גרסה ${p.current.version}: ${p.current.steps.map((st, i) => `${i + 1}. ${st.title} (${STEP_MODE_LABELS[st.mode]}${st.requiresApproval ? ", דורש אישור" : ""})`).join(" ")}`
            : "אין עדיין נוהל מאושר",
          p.current?.highlights ? `דגשים: ${p.current.highlights}` : null,
          ...(p.current?.checks ?? []).filter((c) => !c.excepted).map((c) => `לא עומד בכללים: ${c.message}`),
          p.exceptionPlaybook ? `נוהל חריגים: ${p.exceptionPlaybook}` : null,
        ],
        // Its owner is already in the details.
        ...knowledge({ ...p, ownerId: null }),
      })),
    },
    {
      number: "7.5",
      title: "סוגי פניות ודרכי מענה",
      empty: "עוד לא נכתב מה מגיע, ממי ואיך עונים.",
      items: requestTypes.filter(shown).map((r) => ({
        ref: r.id,
        text: r.title,
        details: [
          r.fromWho ? `מ: ${r.fromWho}` : null,
          r.arrivesVia ? `דרך: ${r.arrivesVia}` : null,
          r.entity?.name,
          r.handling,
          routeNames(r.routeToContactIds, contactName),
          // Named only from the processes this version shows.
          (() => {
            const p = processes.filter(shown).find((x) => x.id === r.processId);
            return p ? `מפעיל: ${p.code} ${p.title}` : null;
          })(),
          ...(warnings.requestTypes[r.id] ?? []),
        ],
        ...knowledge(r),
      })),
    },
    { number: "8", title: "כספים וכללי אישור", empty: "אין עדיין עובדות כספיות או כללי אישור.", items: [...of("FINANCE").map(factItem), ...rulesIn("8")] },
    {
      number: "9",
      title: "תקשורת",
      empty: "עוד לא נכתב באילו ערוצים פונים למי.",
      items: [...contacts.filter((c) => c.channelOrder.length > 0).map((c) => ({ text: `${c.person.name ?? c.role}: ${c.channelOrder.join(", ")}` })), ...rulesIn("9")],
    },
    {
      number: "10",
      title: "תאריכים ואירועים חוזרים",
      empty: "אין מועדים.",
      items: dates
        .filter((d) => d.status === "ACTIVE" && (!ai || d.sensitivity !== "SENSITIVE"))
        .map((d) => ({ text: d.title, details: [d.nextOccurrenceAt ? `הבא: ${day(d.nextOccurrenceAt)}` : null, d.expectsReceipt ? `${RECEIPT_LABEL}${d.expectedFrom ? ` מ-${d.expectedFrom}` : ""}` : null] })),
    },
    {
      number: "11",
      title: "מידע נוכחי או זמני",
      empty: "אין מידע זמני.",
      items: of("TEMPORARY").filter((f) => !f.closedAt).map(factItem),
    },
    { number: "12", title: "החלטות חד-פעמיות", empty: "אין החלטות חד-פעמיות.", items: of("ONE_OFF_DECISION").map(factItem) },
    {
      number: "13",
      title: "שאלות פתוחות",
      empty: "אין שאלות פתוחות.",
      items: of("QUESTION").filter((f) => !f.answeredAt).map(factItem),
    },
    {
      number: "14",
      title: "כללי עבודה ספציפיים",
      empty: "אין כללי עבודה או כללי טיפול במידע.",
      items: rulesIn("14"),
    },
    { number: "", title: "הערות", empty: "אין הערות.", items: of("NOTE").map(factItem) },
  ];

  // Section 15 is a view, not a list anyone keeps: every item above that
  // is not confirmed, in one place.
  const pending = sections
    .flatMap((s) => s.items.map((i) => ({ ...i, where: s.title })))
    .filter((i) => i.status === "UNCERTAIN" || i.status === "MISSING" || ("proposed" in i && i.proposed))
    .map(({ where, group: _group, ...i }) => {
      const { proposed: _proposed, ...item } = i as typeof i & { proposed?: boolean };
      return { ...item, details: [where, ...(item.details ?? [])] };
    });
  sections.push({ number: "15", title: "ממתין לאישור וסתירות", empty: "אין פריטים שממתינים לאישור.", items: pending });

  sections.push({
    number: "16",
    title: "יומן עדכונים",
    empty: "אין עדכונים.",
    items: [
      ...batches.map((b) => {
        const src = b.sourceId ? sources.find((x) => x.id === b.sourceId) : null;
        return batchItem({ createdAt: b.createdAt, via: b.via, note: b.note, source: src ? { code: src.code, title: src.title } : null, states: b.proposals.map((p) => p.state) }, day);
      }),
      ...audit.map((a) => ({ text: `${day(a.createdAt)}: ${ACTION_LABEL[a.action] ?? a.action}`, details: [a.actor?.name], group: CHANGES_GROUP })),
    ],
  });

  // The same rows the sections show, so the line never counts what this
  // reader cannot see.
  const control = controlParts(
    controlFrom({
      processes: processes.filter(shown),
      exceptions,
      facts: current,
      otherItems: [...contacts, ...orgs, ...systems.filter(shown), ...entities.filter(shown), ...requestTypes.filter(shown), ...rules],
      systems: systems.filter(shown),
      daysSinceBatch,
    })
  );

  // Spec 3.1: the owners, by name.
  const keeperIds = [...new Set(sections.flatMap((x) => x.items.map((i) => i.owner)).filter((x): x is string => !!x))];
  const keeperName = new Map((await prisma.user.findMany({ where: { id: { in: keeperIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return {
    clientName: client.name,
    generatedAt: now,
    audience: options.audience,
    control,
    sections: sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.text).map((i) => {
        const { proposed: _proposed, ...item } = i as typeof i & { proposed?: boolean };
        return { ...item, owner: item.owner ? (keeperName.get(item.owner) ?? null) : null };
      }),
    })),
    legend: sources.map((s) => ({
      code: s.code,
      title: s.title,
      details: [SOURCE_KIND_LABELS[s.kind], day(s.occurredAt), s.weight === "SECONDARY" ? SOURCE_WEIGHT_LABELS.SECONDARY : null, s.restriction === "TOPICS_ONLY" ? "נושאים בלבד" : null]
        .filter(Boolean)
        .join(", "),
    })),
  };
}
