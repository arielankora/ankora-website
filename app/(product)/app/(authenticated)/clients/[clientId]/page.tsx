import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getClient, listStaffForAssignment } from "@/lib/app-domain/clients";
import { listDecisionsForClient } from "@/lib/app-domain/decisions";
import { listClientDocuments } from "@/lib/app-domain/client-documents";
import { listPortalSummaries } from "@/lib/app-domain/portal-summary";
import { clientDocumentsFolder } from "@/lib/google-drive";
import {
  listImportantDates,
  IMPORTANT_DATE_STATUS_LABELS,
  listHolidayCalendars,
  listHolidaySubscriptionsForClient,
} from "@/lib/app-domain/important-dates";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EditClientForm } from "./EditClientForm";
import { DecisionsPanel } from "./DecisionsPanel";
import { DocumentsPanel, SummaryPanel } from "./FilePanel";
import { HolidayCalendarsPanel } from "../HolidayCalendarsPanel";
import { TasksPanel } from "./TasksPanel";
import { PeoplePanel } from "./PeoplePanel";
import { listClientPeople, listOrganizationNames } from "@/lib/app-domain/client-contacts";
import { effectiveStatus, parseFieldStatus } from "@/lib/knowledge";
import { SourcesPanel } from "./SourcesPanel";
import { listClientSources, listClientDomains } from "@/lib/app-domain/client-sources";
import { formatSourceRef, readSourceRefs } from "@/lib/knowledge-sources";
import { SystemsPanel } from "./SystemsPanel";
import { FactsPanel, type PanelFact } from "./FactsPanel";
import { EntitiesPanel } from "./EntitiesPanel";
import { listClientEntities } from "@/lib/app-domain/client-entities";
import { countPendingProposals } from "@/lib/app-domain/knowledge-proposals";
import { RequestTypesPanel } from "./RequestTypesPanel";
import { paramsInForce, paramsSummary, readParams } from "@/lib/policy-params";
import { readReviewReason, reviewDueAt } from "@/lib/process-review";
import { ControlLine } from "./ControlLine";
import { controlFrom, controlParts } from "@/lib/client-control";
import { daysSinceLastBatch } from "@/lib/app-domain/client-control";
import { DisclosureBanner, PoliciesPanel } from "./PoliciesPanel";
import { listClientPolicies } from "@/lib/app-domain/client-policies";
import { listOpenExceptions } from "@/lib/app-domain/policy-exceptions";
import { listProcesses, ruleWarnings } from "@/lib/app-domain/processes";
import { listLessons } from "@/lib/app-domain/process-lessons";
import { listProcessRuns } from "@/lib/app-domain/process-runs";
import { listProcessChecks } from "@/lib/app-domain/process-checks";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { checkDueKey, checkEveryText, checkState, isRoutine } from "@/lib/process-checks";
import { ProcessesPanel } from "./ProcessesPanel";
import { canApproveForClient, ruleApproversFor } from "@/lib/app-domain/rule-approvals";
import { EXCEPTION_MAX_DAYS } from "@/lib/client-policies";
import { ruleInForce } from "@/lib/client-policies";
import { NarrativesPanel } from "./NarrativesPanel";
import { listRequestTypes } from "@/lib/app-domain/request-types";
import { listNarratives } from "@/lib/app-domain/client-narratives";
import { renderMarkdownLite } from "@/lib/markdown-lite";
import { listClientFacts } from "@/lib/app-domain/client-facts";
import { listSystemMap } from "@/lib/app-domain/system-map";
import { listCredentials } from "@/lib/app-domain/credentials";
import { clientTaskOverview } from "@/lib/app-domain/tasks";
import { MessageClient } from "@/components/app/MessageClient";
import { messageComposerProps } from "@/lib/app-domain/client-messages";
import { appBaseUrl } from "@/lib/email-templates";
import { listCategories } from "@/lib/app-domain/categories";
import type { ImportantDateStatus } from "@prisma/client";

const STATUS_TONE: Record<ImportantDateStatus, "green" | "amber" | "gray" | "red"> = {
  ACTIVE: "green",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "amber",
  HANDLED_CURRENT: "gray",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

export const metadata = { robots: { index: false, follow: false } };

/// The one clock reading for this render, taken outside the component so
/// React Compiler's purity rule sees a call, not a hidden input: the facts
/// panel and its first paint must agree on what has expired.
function serverNow(): number {
  return Date.now();
}

export default async function ClientDetailPage(props: { params: Promise<{ clientId: string }>; searchParams?: Promise<{ tab?: string }> }) {
  const params = await props.params;
  // Two tabs (org-brain spec 6.1): the day-to-day work, and the client
  // file. The file has a dozen sections, and on one long page they would
  // bury the tasks people open this screen for.
  const tab = (await props.searchParams)?.tab === "file" ? "file" : "work";
  const user = await requireUser();

  if (!can(user.role, "client.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const client = await getClient(params.clientId);
  if (!client) notFound();

  // Phase 10 ("מועדים חשובים") client-detail "Dates" section - reuses
  // listImportantDates' own access scoping (this page is already gated on
  // client.manage, a superset of every role that can reach
  // listImportantDates, so the call always succeeds here).
  const clientDates = await listImportantDates(user, { clientId: client.id });

  // Portal phase 2: the decisions panel and the account-manager picker.
  // Portal phase 3: the documents and the monthly summary.
  const [decisions, staff, documents, summaries, taskOverview, allCategories, composer, people, organizationNames, sources, domains, systems, vault, facts, entities, pendingProposals, requestTypes, narratives, policies, exceptions, ruleApprovers, canDecideExceptions, processes, warnings, daysSinceBatch] = await Promise.all([
    listDecisionsForClient(user, client.id),
    listStaffForAssignment(),
    listClientDocuments(user, client.id),
    listPortalSummaries(user, client.id),
    clientTaskOverview(user, client.id),
    listCategories(),
    // No subject. On this screen the message is about the client and
    // not about one piece of work, and a draft that names a task
    // somebody did not have in mind is a draft they have to delete a
    // sentence out of before sending.
    messageComposerProps({
      clientId: client.id,
      fromName: user.name,
      portalUrl: `${appBaseUrl()}/app/portal`,
    }),
    // Org brain, phase 2 (spec 3.5): the file's people and organizations.
    listClientPeople(user, client.id),
    listOrganizationNames(user, client.id),
    // Spec 3.2: the source register every item cites, and the domains.
    listClientSources(user, client.id),
    listClientDomains(user, client.id),
    // Spec 3.6: the system map, and the vault's entry names for linking
    // (names only, and only for people who may open the vault).
    listSystemMap(user, client.id),
    can(user.role, "credential.view") ? listCredentials(user, client.id) : Promise.resolve(null),
    // Spec 3.4: the facts, current and superseded.
    listClientFacts(user, client.id),
    // Spec 3.3: the legal entities people and systems belong to.
    listClientEntities(user, client.id),
    // Spec 5.2: what Claude proposed for this file and nobody approved yet.
    countPendingProposals(user, client.id),
    // Spec 3.7 and 3.3: request types, and the file's free text.
    listRequestTypes(user, client.id),
    listNarratives(user, client.id),
    // Phase 3, spec 3.11: the client's own rules.
    listClientPolicies(user, client.id),
    // Exceptions to them, and who decides (decision 5).
    listOpenExceptions(user, client.id),
    ruleApproversFor(client.id),
    canApproveForClient(user, client.id),
    // Phase 1, spec 3.8 and 3.9: processes and their procedures.
    listProcesses(user, client.id),
    // Where the client's rules disagree with the file (R8, R16).
    ruleWarnings(user, client.id),
    // Spec 7.6: when the extraction last delivered.
    daysSinceLastBatch(client.id),
  ]);
  // The last runs of each process, for its card.
  const runsByProcess = new Map(await Promise.all(processes.map(async (p) => [p.id, await listProcessRuns(user, p.id)] as const)));
  // And of each ongoing one, its last checks.
  const checksByProcess = new Map(
    await Promise.all(processes.filter((p) => p.triggerKinds.includes("CONTINUOUS")).map(async (p) => [p.id, await listProcessChecks(user, p.id)] as const))
  );
  // Spec 5.4: what people who closed runs said about each procedure.
  const lessons = await listLessons(processes.map((p) => p.id));
  const todayKey = localDateKey(new Date(), TIMEZONE);
  const shortDate = (d: Date) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d);
  const entityOptions = entities.map((e) => ({ id: e.id, name: e.name }));
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const sourceOptions = sources.map((s) => ({ code: s.code, title: s.title }));
  // Whose preference a fact is: someone already in this client's file.
  const subjects = [
    ...people.contacts.map((c) => ({ value: `contact:${c.id}`, label: c.person.name ?? c.role ?? "" })),
    ...people.organizations.map((o) => ({ value: `org:${o.id}`, label: o.organization.name })),
  ];
  const subjectLabel = new Map(subjects.map((s) => [s.value, s.label]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const renderedAt = serverNow();
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const toPanelFact = (f: (typeof facts.current)[number]): PanelFact => {
    const subjectKey = f.subjectContactId ? `contact:${f.subjectContactId}` : f.subjectOrgId ? `org:${f.subjectOrgId}` : "";
    return {
      id: f.id,
      kind: f.kind,
      topic: f.topic,
      body: f.body,
      subject: subjectKey ? subjectLabel.get(subjectKey) ?? null : null,
      subjectKey,
      referTo: f.referTo,
      validUntil: iso(f.validUntil),
      validUntilEvent: f.validUntilEvent,
      closedAt: iso(f.closedAt),
      decidedAt: iso(f.decidedAt),
      decidedBy: f.decidedBy,
      assigneeId: f.assigneeId,
      assigneeName: f.assigneeId ? staffName.get(f.assigneeId) ?? null : null,
      answer: f.answer,
      answeredAt: iso(f.answeredAt),
      taskId: f.taskId,
      status: effectiveStatus(f.knowledgeStatus, parseFieldStatus(f.fieldStatus)),
      toResolve: f.toResolve,
      lowImportance: f.importance === "LOW",
      audience: f.audience,
      doNotDisclose: f.doNotDisclose,
      sources: readSourceRefs(f.sources).map(formatSourceRef),
      supersededAt: iso(f.supersededAt),
      alternatives: (Array.isArray(f.alternatives) ? (f.alternatives as { value?: unknown; sources?: unknown }[]) : [])
        .filter((a) => typeof a?.value === "string")
        .map((a) => ({ value: a.value as string, sources: readSourceRefs(a.sources).map(formatSourceRef) })),
    };
  };
  const taskCategories = allCategories
    .filter((cat) => cat.active && (cat.visibility === "GLOBAL" || cat.clientId === client.id))
    .map((cat) => ({ id: cat.id, name: cat.name, clientId: cat.clientId }));

  const monthLabel = (date: Date) =>
    new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);

  // Phase 10 follow-up ("לוחות חגים" UI gap - ADR 21.6): gate matches
  // setHolidayCalendarSubscription()'s own important_date.manage_catalog
  // check, so the section (and its data fetch) simply doesn't render for
  // anyone else, rather than rendering then failing on first click.
  const canManageHolidayCalendars = can(user.role, "important_date.manage_catalog");
  const holidayCalendars = canManageHolidayCalendars ? listHolidayCalendars() : [];
  const holidaySubscriptions = canManageHolidayCalendars
    ? await listHolidaySubscriptionsForClient(user, client.id)
    : [];

  return (
    <>
      <div className="space-y-6">
        <div>
          <Link href="/app/clients" className="text-xs text-appNavy/50 hover:text-gold-dim">
            ← חזרה לרשימת הלקוחות
          </Link>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-medium text-appNavy">{client.name}</h1>
            {/* The same button as on a task, on the screen somebody
                opens when they want to write to a client without a task
                in mind. Nothing here sends by itself. See
                claude/client-communication-rule-2026-09-25.md. */}
            <div className="flex flex-wrap items-center gap-3">
              {/* The file to read, top to bottom, and to download. */}
              {pendingProposals > 0 && (
                <Link href={`/app/knowledge?clientId=${client.id}`} className="text-sm text-warning hover:underline">
                  {pendingProposals === 1 ? "הצעה אחת ממתינה לאישור" : `${pendingProposals} הצעות ממתינות לאישור`}
                </Link>
              )}
              <Link href={`/app/clients/${client.id}/client-file`} className="text-sm text-gold-dim hover:underline">
                תיק הלקוח לקריאה
              </Link>
              {composer && <MessageClient clientId={client.id} {...composer} />}
            </div>
          </div>
        </div>

        <ControlLine
          parts={controlParts(
            controlFrom({
              processes,
              exceptions,
              facts: facts.current,
              otherItems: [...people.contacts, ...people.organizations, ...systems, ...entities, ...requestTypes, ...policies.filter((p) => p.status !== "RETIRED")],
              systems,
              daysSinceBatch,
            })
          )}
        />

        <DisclosureBanner
          rules={policies
            .filter((p) => p.kind === "DISCLOSURE" && p.status !== "RETIRED")
            .map((p) => ({ id: p.id, title: p.title, text: ruleInForce(p)!.text, proposed: p.status === "PROPOSED" }))}
        />

        <nav className="flex gap-1 border-b border-lineDark" aria-label="לשוניות הלקוח">
          {(
            [
              ["work", "עבודה שוטפת", `/app/clients/${client.id}`],
              ["file", "תיק הלקוח", `/app/clients/${client.id}?tab=file`],
            ] as const
          ).map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              aria-current={tab === key ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "border-gold font-medium text-appNavy" : "border-transparent text-appNavy/55 hover:text-appNavy"}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {tab === "file" && (
          <>
            <NarrativesPanel
              clientId={client.id}
              narratives={narratives.map((n) => ({
                kind: n.kind,
                version: n.current?.version ?? 0,
                body: n.current?.body ?? "",
                html: n.current ? renderMarkdownLite(n.current.body) : "",
                meta: n.current ? `גרסה ${n.current.version}, ${shortDate(n.current.createdAt)}${n.current.createdByName ? `, ${n.current.createdByName}` : ""}` : null,
                history: n.history.map((h) => ({
                  version: h.version,
                  meta: `גרסה ${h.version}, ${shortDate(h.createdAt)}${h.createdByName ? `, ${h.createdByName}` : ""}`,
                  html: renderMarkdownLite(h.body),
                })),
              }))}
            />

            <EntitiesPanel
              clientId={client.id}
              sourceOptions={sourceOptions}
              entities={entities.map((e) => {
                const fields = parseFieldStatus(e.fieldStatus);
                const missing = Object.entries(fields).filter(([, v]) => v.status === "MISSING");
                return {
                  id: e.id,
                  name: e.name,
                  legalName: e.legalName,
                  registrationNumber: e.registrationNumber,
                  country: e.country,
                  currency: e.currency,
                  billingAddress: e.billingAddress,
                  parentId: e.parentId,
                  parentName: e.parent?.name ?? null,
                  missingFields: missing.map(([k]) => k),
                  missingToResolve: missing[0]?.[1].toResolve ?? null,
                  status: effectiveStatus(e.knowledgeStatus, fields),
                  ownStatus: e.knowledgeStatus,
                  toResolve: e.toResolve,
                  sources: readSourceRefs(e.sources).map(formatSourceRef),
                };
              })}
            />

            <PeoplePanel
              clientId={client.id}
              organizationNames={organizationNames}
              sourceOptions={sourceOptions}
              entities={entityOptions}
              contacts={people.contacts.map((c) => ({
                id: c.id,
                name: c.person.name,
                role: c.role,
                relationship: c.relationship,
                organizationName: c.person.organization?.name ?? null,
                entityId: c.entityId,
                entityName: c.entityId ? entityName.get(c.entityId) ?? null : null,
                emails: c.person.emails,
                phones: c.person.phones,
                context: c.context,
                channelOrder: c.channelOrder,
                isPrimary: c.isPrimary,
                isDecisionMaker: c.isDecisionMaker,
                clientSideAddress: c.clientSideAddress,
                status: effectiveStatus(c.knowledgeStatus, parseFieldStatus(c.fieldStatus)),
                toResolve: c.toResolve,
                audience: c.audience,
                doNotDisclose: c.doNotDisclose,
                sensitive: c.sensitivity === "SENSITIVE",
                sources: readSourceRefs(c.sources).map(formatSourceRef),
              }))}
              organizations={people.organizations.map((o) => ({
                id: o.id,
                name: o.organization.name,
                domains: o.organization.domains,
                role: o.role,
                relationship: o.relationship,
                monthlyCostMinor: o.monthlyCostMinor,
                currency: o.currency,
                notes: o.notes,
                status: effectiveStatus(o.knowledgeStatus, parseFieldStatus(o.fieldStatus)),
                toResolve: o.toResolve,
                sources: readSourceRefs(o.sources).map(formatSourceRef),
              }))}
            />

            <FactsPanel
              clientId={client.id}
              now={renderedAt}
              sourceOptions={sourceOptions}
              staff={staff.map((s) => ({ value: s.id, label: s.name }))}
              subjects={subjects}
              facts={facts.current.map(toPanelFact)}
              history={facts.superseded.map(toPanelFact)}
            />

            <ProcessesPanel
              clientId={client.id}
              userId={user.id}
              canApprove={can(user.role, "client.manage")}
              sourceOptions={sourceOptions}
              entities={entityOptions}
              staff={staff.map((u) => ({ id: u.id, name: u.name }))}
              contacts={people.contacts.map((c) => ({ id: c.id, name: c.person.name ?? c.role ?? "" }))}
              systems={systems.map((x) => ({ id: x.id, name: x.systemName }))}
              rules={policies
                .filter((x) => x.status !== "RETIRED" && (x.kind === "THRESHOLD" || x.kind === "APPROVAL_REQUIRED"))
                .map((x) => ({ id: x.id, name: x.title }))}
              dates={clientDates.map((d) => ({ id: d.id, name: d.title }))}
              processes={processes.map((p) => ({
                id: p.id,
                code: p.code,
                title: p.title,
                purpose: p.purpose,
                status: p.status,
                triggerKinds: p.triggerKinds,
                triggerText: p.triggerText,
                ownerId: p.ownerId,
                backupOwnerId: p.backupOwnerId,
                slaText: p.slaText,
                slaBusinessDays: p.slaBusinessDays,
                externalPartyContactIds: p.externalPartyContactIds,
                externalPartyText: p.externalPartyText,
                requiredSystemIds: p.requiredSystemIds,
                approverText: p.approverText,
                approverUserId: p.approverUserId,
                approverContactId: p.approverContactId,
                approvalPolicyIds: p.approvalPolicyIds,
                approvalText: p.approvalText,
                exceptionPlaybook: p.exceptionPlaybook,
                entityId: p.entityId,
                executorText: p.executorText,
                transitionStatus: p.transitionStatus,
                knowledgeStatus: effectiveStatus(p.knowledgeStatus, parseFieldStatus(p.fieldStatus)),
                toResolve: p.toResolve,
                sources: readSourceRefs(p.sources).map(formatSourceRef),
                score: p.completeness.score,
                gaps: p.gaps,
                nextDate: p.nextDate ? p.nextDate.toISOString() : null,
                dateIds: p.dates.map((d) => d.id),
                latestVersion: p.latestVersion,
                current: p.current
                  ? {
                      version: p.current.version,
                      steps: p.current.steps,
                      highlights: p.current.highlights,
                      outputs: p.current.outputs,
                      approvedByName: p.current.approvedById ? staffName.get(p.current.approvedById) ?? null : null,
                      checks: p.current.checks,
                    }
                  : null,
                runs: (runsByProcess.get(p.id) ?? []).map((r) => ({ id: r.id, title: r.title, status: r.status, dueDate: r.dueDate ? r.dueDate.toISOString() : null })),
                checkEveryDays: p.checkEveryDays,
                reviewReason: readReviewReason(p.reviewReason),
                reviewEveryDays: p.reviewEveryDays,
                reviewDueAt: p.status === "ACTIVE" || p.status === "PAUSED" ? reviewDueAt(p)?.toISOString() ?? null : null,
                checkEvery: p.checkEveryDays ? checkEveryText(p.checkEveryDays) : null,
                checkText: p.checkText,
                routine: isRoutine(p),
                checkDue: (() => {
                  if (!isRoutine(p)) return null;
                  const key = checkDueKey({ checkEveryDays: p.checkEveryDays, lastCheckedKey: p.lastCheckedAt ? localDateKey(p.lastCheckedAt, TIMEZONE) : null }, todayKey);
                  return key ? { key, state: checkState(key, todayKey) } : null;
                })(),
                checks: (checksByProcess.get(p.id) ?? []).map((c) => ({
                  id: c.id,
                  outcome: c.outcome,
                  note: c.note,
                  createdAt: c.createdAt.toISOString(),
                  checkedByName: c.checkedByName,
                  taskId: c.taskId,
                })),
                draft: p.draft
                  ? { version: p.draft.version, steps: p.draft.steps, highlights: p.draft.highlights, outputs: p.draft.outputs, changeNote: p.draft.changeNote, checks: p.draft.checks }
                  : null,
                lessons: lessons
                  .filter((l) => l.processId === p.id)
                  .map((l) => ({
                    id: l.id,
                    status: l.status,
                    body: l.body,
                    version: l.version,
                    taskId: l.taskId,
                    runTitle: l.runTitle,
                    authorName: l.authorName,
                    createdAt: l.createdAt.toISOString(),
                    resolution: l.resolution,
                    resolvedByName: l.resolvedByName,
                  })),
              }))}
            />

            <PoliciesPanel
              clientId={client.id}
              sourceOptions={sourceOptions}
              canApprove={can(user.role, "client.manage")}
              exceptions={exceptions.map((e) => ({
                id: e.id,
                policyId: e.policyId,
                what: e.what,
                reason: e.reason,
                validUntil: e.validUntil.toISOString(),
                status: e.status as "REQUESTED" | "APPROVED",
                requestedById: e.requestedById,
                requestedByName: e.requestedByName,
                decidedByName: e.decidedByName,
                decisionNote: e.decisionNote,
              }))}
              approvers={ruleApprovers}
              clientApproverIds={client.ruleApproverIds}
              staff={staff.map((s) => ({ id: s.id, name: s.name }))}
              canDecideExceptions={canDecideExceptions}
              viewerId={user.id}
              maxExceptionDays={EXCEPTION_MAX_DAYS}
              entities={entityOptions}
              policies={policies.map((p) => ({
                id: p.id,
                kind: p.kind,
                status: p.status,
                version: p.version,
                title: p.title,
                statement: p.statement,
                rationale: p.rationale,
                interimStatement: p.interimStatement,
                params: readParams(p.kind, p.params),
                interimParams: readParams(p.kind, p.interimParams),
                checked: paramsSummary(p.kind, paramsInForce(p), (id) => entityName.get(id) ?? "ישות שהוסרה"),
                approvedByName: p.approvedById ? staffName.get(p.approvedById) ?? null : null,
                approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
                knowledgeStatus: effectiveStatus(p.knowledgeStatus, parseFieldStatus(p.fieldStatus)),
                toResolve: p.toResolve,
                sources: readSourceRefs(p.sources).map(formatSourceRef),
              }))}
            />

            <RequestTypesPanel
              clientId={client.id}
              ruleWarnings={warnings.requestTypes}
              sourceOptions={sourceOptions}
              entities={entityOptions}
              processes={processes.map((p) => ({ id: p.id, name: `${p.code} ${p.title}` }))}
              contacts={people.contacts.map((c) => ({ id: c.id, name: c.person.name ?? c.role ?? "" }))}
              requestTypes={requestTypes.map((r) => ({
                id: r.id,
                title: r.title,
                fromWho: r.fromWho,
                arrivesVia: r.arrivesVia,
                handling: r.handling,
                routeToContactIds: r.routeToContactIds,
                routeToNames: r.routeToNames,
                entityId: r.entityId,
                entityName: r.entity?.name ?? null,
                processId: r.processId,
                processName: (() => {
                  const p = processes.find((x) => x.id === r.processId);
                  return p ? `${p.code} ${p.title}` : null;
                })(),
                status: effectiveStatus(r.knowledgeStatus, parseFieldStatus(r.fieldStatus)),
                toResolve: r.toResolve,
                sources: readSourceRefs(r.sources).map(formatSourceRef),
              }))}
            />

            <SystemsPanel
              clientId={client.id}
              ruleWarnings={warnings.systems}
              sourceOptions={sourceOptions}
              vault={vault ? vault.map((v) => ({ id: v.id, systemName: v.systemName })) : null}
              entities={entityOptions}
              systems={systems.map((s) => ({
                id: s.id,
                systemName: s.systemName,
                purpose: s.purpose,
                entityId: s.entityId,
                entityName: s.entityId ? entityName.get(s.entityId) ?? null : null,
                url: s.url,
                accountUsed: s.accountUsed,
                ourPermission: s.ourPermission,
                accessStatus: s.accessStatus,
                blocker: s.blocker,
                clientAdmin: s.clientAdmin,
                credential: s.credential,
                billingCycle: s.billingCycle,
                billingCostMinor: s.billingCostMinor,
                billingCurrency: s.billingCurrency,
                cardLast4: s.cardLast4,
                invoiceTo: s.invoiceTo,
                notes: s.notes,
                status: effectiveStatus(s.knowledgeStatus, parseFieldStatus(s.fieldStatus)),
                toResolve: s.toResolve,
                audience: s.audience,
                doNotDisclose: s.doNotDisclose,
                sources: readSourceRefs(s.sources).map(formatSourceRef),
              }))}
            />

            <SourcesPanel
              clientId={client.id}
              sources={sources.map((s) => ({
                id: s.id,
                code: s.code,
                kind: s.kind,
                weight: s.weight,
                title: s.title,
                occurredAt: s.occurredAt ? s.occurredAt.toISOString() : null,
                participants: s.participants,
                topicsOnly: s.restriction === "TOPICS_ONLY",
                notes: s.notes,
              }))}
              domains={domains.map((d) => ({
                id: d.id,
                domain: d.domain,
                kind: d.kind,
                organizationName: d.organization?.name ?? null,
              }))}
            />

          </>
        )}

        {tab === "work" && (
          <>
            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <EditClientForm client={client} staff={staff} />
            </div>

            <TasksPanel
              clientId={client.id}
              clientName={client.name}
              openCount={taskOverview.openCount}
              closedRecently={taskOverview.closedRecently}
              untaskedSecondsThisMonth={taskOverview.untaskedSecondsThisMonth}
              categories={taskCategories}
              tasks={taskOverview.open.map((t) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assigneeName: t.assignedTo?.name ?? null,
                dueDate: t.dueDate ? t.dueDate.toISOString() : null,
                seconds: taskOverview.hoursByTask.get(t.id) ?? 0,
              }))}
            />

            <DocumentsPanel
              clientId={client.id}
              storageReady={clientDocumentsFolder() !== null}
              documents={documents.map((d) => ({
                id: d.id,
                title: d.title,
                kind: d.kind,
                clientVisible: d.clientVisible,
                sizeBytes: d.sizeBytes,
                createdAt: d.createdAt.toISOString(),
                uploadedByName: d.uploadedBy?.name ?? null,
                taskTitle: d.task ? d.task.clientTitle?.trim() || d.task.title : null,
              }))}
            />

            <SummaryPanel
              clientId={client.id}
              composer={composer}
              summaries={summaries.map((s) => ({
                id: s.id,
                periodLabel: monthLabel(s.periodStart),
                draft: s.draft,
                status: s.status,
                approvedByName: s.approvedBy?.name ?? null,
                approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
                sourceCount: s.sourceTaskIds.length + s.sourceDecisionIds.length,
              }))}
            />

            <DecisionsPanel
              clientId={client.id}
              ceilingMinor={client.approvalCeilingMinor}
              composer={composer}
              decisions={decisions.map((d) => ({
                id: d.id,
                question: d.question,
                status: d.status,
                amountMinor: d.amountMinor,
                createdAt: d.createdAt.toISOString(),
                answer: d.answer
                  ? {
                      optionLabel: d.answer.optionLabel,
                      respondedByName: d.answer.respondedByName,
                      respondedAt: d.answer.respondedAt.toISOString(),
                    }
                  : null,
              }))}
            />

            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <h2 className="text-sm font-medium text-appNavy">קטגוריות ({client.categories.length})</h2>
              {client.categories.length === 0 ? (
                <p className="mt-2 text-sm text-appNavy/50">אין עדיין קטגוריות ייעודיות ללקוח זה.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {client.categories.map((cat) => (
                    <li key={cat.id} className="text-sm text-appNavy/70">
                      {cat.name}
                      {!cat.active && <span className="ms-2 text-xs text-appNavy/40">(לא פעיל)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-appNavy">מועדים חשובים ({clientDates.length})</h2>
                <Link href={`/app/important-dates?clientId=${client.id}`} className="text-xs text-gold-dim underline underline-offset-4">
                  לכל המועדים של הלקוח
                </Link>
              </div>
              {clientDates.length === 0 ? (
                <p className="mt-2 text-sm text-appNavy/50">אין עדיין מועדים חשובים ללקוח זה.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {clientDates.slice(0, 8).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link href={`/app/important-dates/${d.id}`} className="text-appNavy hover:text-gold-dim">
                        {d.title}
                      </Link>
                      <StatusBadge label={IMPORTANT_DATE_STATUS_LABELS[d.status]} tone={STATUS_TONE[d.status]} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canManageHolidayCalendars && (
              <div className="rounded-2xl border border-lineDark bg-white p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-appNavy">לוחות חגים</h2>
                  <span className="text-xs text-appNavy/40">תזכורות ברירת מחדל: 30 ו-7 ימים לפני</span>
                </div>
                <p className="mt-1 text-xs text-appNavy/50">
                  רישום הלקוח ללוח חג יוצר אוטומטית מועד חשוב לכל חג בלוח, ומתעדכן מדי שנה.
                </p>
                <HolidayCalendarsPanel clientId={client.id} calendars={holidayCalendars} subscriptions={holidaySubscriptions} />
              </div>
            )}

            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <h2 className="text-sm font-medium text-appNavy">משתמשים מוקצים ({client.employeeAccess.length})</h2>
              {client.employeeAccess.length === 0 ? (
                <p className="mt-2 text-sm text-appNavy/50">אין עדיין אנשי צוות מוקצים ללקוח זה.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {client.employeeAccess.map((access) => (
                    <li key={access.id} className="text-sm text-appNavy/70">
                      {access.user.name} <span className="text-xs text-appNavy/40">({access.user.email})</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-appNavy/40">
                הקצאת אנשי צוות ללקוחות מתבצעת מעמוד{" "}
                <Link href="/app/users" className="underline">
                  משתמשים
                </Link>
                .
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
