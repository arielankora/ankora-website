import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { effectiveStatus, parseFieldStatus } from "@/lib/knowledge";
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
import { ACTION_LABEL } from "@/app/(product)/app/(authenticated)/audit-log/labels";
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
// card digits or vault names, and nothing marked sensitive.

const RELATIONSHIP: Record<string, string> = {
  CLIENT_STAFF: "צוות הלקוח",
  PROVIDER: "נותן שירות",
  ADVISOR: "יועץ",
  INVESTOR: "משקיע",
  SUPPLIER: "ספק",
  ANKORA: "אנקורה",
};

/// The entity types whose changes make up section 16.
const FILE_ENTITY_TYPES = ["ClientContact", "ClientOrganization", "ClientSource", "ClientDomain", "SystemAccess", "ClientFact", "ClientEntity"];

function day(d: Date | null | undefined): string | null {
  return d ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d) : null;
}

function knowledge(row: { knowledgeStatus: DocItem["status"]; fieldStatus: unknown; toResolve: string | null; sources: unknown; doNotDisclose: string | null }): Pick<DocItem, "status" | "toResolve" | "sources" | "doNotDisclose"> {
  return {
    status: effectiveStatus(row.knowledgeStatus!, parseFieldStatus(row.fieldStatus)),
    toResolve: row.toResolve,
    sources: readSourceRefs(row.sources).map(formatSourceRef),
    doNotDisclose: row.doNotDisclose,
  };
}

export async function buildClientFile(actor: User, clientId: string, options: { audience: "staff" | "ai" }): Promise<ClientFileDoc> {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const ai = options.audience === "ai";
  const shown = (r: { sensitivity: KnowledgeSensitivity }) => !ai || r.sensitivity !== "SENSITIVE";

  const [client, entities, people, facts, systems, sources, dates, audit] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, legalName: true } }),
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
  ]);

  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const contacts = people.contacts.filter(shown);
  const orgs = people.organizations.filter(shown);
  const current = facts.current.filter(shown);
  const of = (kind: ClientFact["kind"]) => current.filter((f) => f.kind === kind);
  const subjectName = new Map<string, string>([
    ...contacts.map((c) => [c.id, c.person.name ?? c.role ?? ""] as [string, string]),
    ...orgs.map((o) => [o.id, o.organization.name] as [string, string]),
  ]);
  const now = new Date();

  const factItem = (f: ClientFact): DocItem & { group?: string } => ({
    text: f.body,
    details: [
      f.subjectContactId || f.subjectOrgId ? subjectName.get((f.subjectContactId ?? f.subjectOrgId)!) : null,
      f.referTo ? `מפנים ל: ${f.referTo}` : null,
      f.kind === "TEMPORARY" ? `בתוקף עד ${day(f.validUntil) ?? f.validUntilEvent}` : null,
      f.kind === "TEMPORARY" && isPastValidity(f, now) ? "עבר התוקף, לבדוק שעדיין נכון" : null,
      f.kind === "ONE_OFF_DECISION" ? [day(f.decidedAt), f.decidedBy].filter(Boolean).join(", ") : null,
      f.answer ? `תשובה: ${f.answer}` : null,
      f.importance === "LOW" ? "לא קריטי" : null,
    ],
    ...knowledge(f),
    // A question's status is the question itself; it is not repeated.
    ...(f.kind === "QUESTION" ? { status: f.answeredAt ? f.knowledgeStatus : undefined, toResolve: null } : {}),
    group: f.topic ? FACT_TOPIC_LABELS[f.topic as FactTopicLike] : undefined,
  });

  const primary = contacts.find((c) => c.isPrimary);
  const sections: DocSection[] = [
    {
      number: "1",
      title: "זהות הלקוח",
      empty: "",
      items: [
        { text: client.legalName ? `${client.name} (${client.legalName})` : client.name },
        ...(primary ? [{ text: `איש קשר ראשי: ${primary.person.name ?? primary.role}`, details: [primary.role] }] : []),
        ...entities.filter(shown).map((e) => ({
          text: `ישות: ${e.name}`,
          details: [e.legalName, e.registrationNumber, e.country, e.currency, e.parent ? `בת של ${e.parent.name}` : null],
          ...knowledge(e),
          toResolve: e.toResolve ?? Object.values(parseFieldStatus(e.fieldStatus))[0]?.toResolve ?? null,
        })),
      ],
    },
    {
      number: "2",
      title: "תחום האחריות שלנו",
      empty: "עוד לא נכתב מה בתחום ומה מחוץ לו.",
      items: [
        ...of("SCOPE_IN").map((f) => ({ ...factItem(f), group: "בתחום" })),
        ...of("SCOPE_OUT").map((f) => ({ ...factItem(f), group: "מחוץ לתחום" })),
      ],
    },
    {
      number: "3",
      title: "אנשים ויחסים",
      empty: "אין עדיין אנשי קשר בתיק.",
      items: contacts.map((c) => ({
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
      number: "7.1",
      title: "מערכות וגישות",
      empty: "אין עדיין מערכות במפה.",
      items: systems.filter(shown).map((s) => ({
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
        ],
        ...knowledge(s),
      })),
    },
    {
      number: "7.2",
      title: "ספקים ונותני שירות",
      empty: "אין עדיין ספקים או נותני שירות קבועים.",
      items: orgs.map((o) => ({
        text: o.organization.name,
        details: [
          o.role,
          RELATIONSHIP[o.relationship],
          o.monthlyCostMinor !== null ? `${o.currency === "USD" ? `$${(o.monthlyCostMinor / 100).toLocaleString("en-US")}` : formatMinor(o.monthlyCostMinor)} בחודש` : null,
          o.notes,
        ],
        ...knowledge(o),
      })),
    },
    { number: "7.3", title: "מקורות ידע ומיקומים", empty: "עוד לא נכתב איפה נמצא הידע.", items: of("LOCATION").map(factItem) },
    { number: "8", title: "כספים", empty: "אין עדיין עובדות כספיות.", items: of("FINANCE").map(factItem) },
    {
      number: "9",
      title: "תקשורת",
      empty: "עוד לא נכתב באילו ערוצים פונים למי.",
      items: contacts.filter((c) => c.channelOrder.length > 0).map((c) => ({ text: `${c.person.name ?? c.role}: ${c.channelOrder.join(", ")}` })),
    },
    {
      number: "10",
      title: "תאריכים ואירועים חוזרים",
      empty: "אין מועדים.",
      items: dates
        .filter((d) => d.status === "ACTIVE" && (!ai || d.sensitivity !== "SENSITIVE"))
        .map((d) => ({ text: d.title, details: [d.nextOccurrenceAt ? `הבא: ${day(d.nextOccurrenceAt)}` : null] })),
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
    { number: "", title: "הערות", empty: "אין הערות.", items: of("NOTE").map(factItem) },
  ];

  // Section 15 is a view, not a list anyone keeps: every item above that
  // is not confirmed, in one place.
  const pending = sections
    .flatMap((s) => s.items.map((i) => ({ ...i, where: s.title })))
    .filter((i) => i.status === "UNCERTAIN" || i.status === "MISSING")
    .map(({ where, group: _group, ...i }) => ({ ...i, details: [where, ...(i.details ?? [])] }));
  sections.push({ number: "15", title: "ממתין לאישור וסתירות", empty: "אין פריטים שממתינים לאישור.", items: pending });

  sections.push({
    number: "16",
    title: "יומן עדכונים",
    empty: "אין עדכונים.",
    items: audit.map((a) => ({ text: `${day(a.createdAt)}: ${ACTION_LABEL[a.action] ?? a.action}`, details: [a.actor?.name] })),
  });

  return {
    clientName: client.name,
    generatedAt: now,
    audience: options.audience,
    sections: sections.map((s) => ({ ...s, items: s.items.filter((i) => i.text) })),
    legend: sources.map((s) => ({
      code: s.code,
      title: s.title,
      details: [SOURCE_KIND_LABELS[s.kind], day(s.occurredAt), s.weight === "SECONDARY" ? SOURCE_WEIGHT_LABELS.SECONDARY : null, s.restriction === "TOPICS_ONLY" ? "נושאים בלבד" : null]
        .filter(Boolean)
        .join(", "),
    })),
  };
}
