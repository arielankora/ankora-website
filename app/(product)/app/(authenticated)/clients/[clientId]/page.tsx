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
import { clientTaskOverview } from "@/lib/app-domain/tasks";
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

export default async function ClientDetailPage(props: { params: Promise<{ clientId: string }> }) {
  const params = await props.params;
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
  const [decisions, staff, documents, summaries, taskOverview, allCategories] = await Promise.all([
    listDecisionsForClient(user, client.id),
    listStaffForAssignment(),
    listClientDocuments(user, client.id),
    listPortalSummaries(user, client.id),
    clientTaskOverview(user, client.id),
    listCategories(),
  ]);
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
          <h1 className="mt-2 text-xl font-medium text-appNavy">{client.name}</h1>
        </div>

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
            <p className="mt-2 text-sm text-appNavy/50">אין עדיין עובדים מוקצים ללקוח זה.</p>
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
            הקצאת עובדים ללקוחות מתבצעת מעמוד{" "}
            <Link href="/app/users" className="underline">
              משתמשים
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
