import { getFormatter, getTranslations } from "next-intl/server";
import { PageBack } from "@/components/app/BackSlot";
import { IMPORTANT_DATES_LIST_KEYS, importantDatesBackTitle, listBackHref } from "@/lib/list-back";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getImportantDate } from "@/lib/app-domain/important-dates";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listUsers } from "@/lib/app-domain/users";
import { listCategories } from "@/lib/app-domain/categories";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Drawer } from "@/components/app/Drawer";
import { ImportantDateForm } from "../ImportantDateForm";
import { ImportantDateStatusSelect } from "../ImportantDateStatusSelect";
import { snoozeImportantDateAction, deleteImportantDateAction, startWorkOnImportantDateAction } from "../actions";
import Link from "next/link";
import { AdvanceWithClaude } from "../../tasks/[id]/AdvanceWithClaude";
import { getTaskDetail } from "@/lib/app-domain/tasks";
import { getTaskPlans } from "@/lib/app-domain/task-plans";
import { advancePromptFor } from "@/lib/app-domain/advance-prompt-input";
import type { ImportantDateStatus } from "@prisma/client";
import { lockedCalendarFor } from "@/lib/app-domain/date-calendars";
import { calendarBackHref } from "@/lib/calendar-keys";
import { isBusinessCalendarKey } from "@/lib/business-calendar";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_TONE: Record<ImportantDateStatus, "green" | "amber" | "gray" | "red"> = {
  ACTIVE: "green",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "amber",
  HANDLED_CURRENT: "gray",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

export default async function ImportantDateDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const params = await props.params;
  const t = await getTranslations("importantDates");
  const tList = await getTranslations("importantDates.list");
  const tTask = await getTranslations("tasks.common");
  const format = await getFormatter();
  const formatDate = (date: Date | null): string => (date ? format.dateTime(date, { dateStyle: "medium" }) : t("detail.noDate"));
  // 19.10.2026: a date opened from the calendar goes back to it, with the
  // same view and filters. See lib/calendar-keys.ts.
  const rawFrom = (await props.searchParams).from;
  const calendarBack = calendarBackHref(typeof rawFrom === "string" ? rawFrom : undefined);
  // Or from the list, with its tab (19.10.2026, lib/list-back.ts).
  const backHref = calendarBack ?? listBackHref("/app/important-dates", IMPORTANT_DATES_LIST_KEYS, rawFrom);
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const [date, clients, users, allCategories] = await Promise.all([
    getImportantDate(user, params.id).catch(() => null),
    listAccessibleClients(user),
    listUsers(),
    listCategories(),
  ]);
  if (!date) notFound();
  // Decision 6: a date that starts a process is on the process's calendar.
  const lock = await lockedCalendarFor(date.processId);
  // How the date's calendar reads when its process decides it. The
  // process's code and title are what people wrote.
  const calendarLine = lock
    ? lock.by === "PROCESS"
      ? t("detail.calendarByProcess", { label: t(`businessCalendar.${lock.key}`), code: lock.code, title: lock.title })
      : t("detail.calendarByEntity", { label: t(`businessCalendar.${lock.key}`), entity: lock.entityName ?? "", code: lock.code, title: lock.title })
    : null;

  // "התחלת עבודה" (8.11.2026): work with Claude and the timer live on a
  // task, so the date shows them for its open task. The prompt is built
  // here, while the page renders, for the same reason as on the task page:
  // the copy has to happen inside the click.
  const ownTasks = date.tasks.filter((t) => t.parentId === null && t.deletedAt === null);
  const workTask =
    ownTasks
      .filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED")
      .sort((x, y) => (y.dueDate?.getTime() ?? 0) - (x.dueDate?.getTime() ?? 0) || y.createdAt.getTime() - x.createdAt.getTime())[0] ?? null;
  const workDetail = workTask ? await getTaskDetail(user, workTask.id).catch(() => null) : null;
  const workPlan = workDetail ? ((await getTaskPlans(user, workDetail.task.id))?.current ?? null) : null;
  const workPrompt = workDetail ? await advancePromptFor(user, workDetail, workPlan, "plan") : null;
  const fromParam = typeof rawFrom === "string" ? rawFrom : "";

  const clientIds = new Set(clients.map((c) => c.id));
  const categoriesForAutoTask = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  return (
    <>
      <div className="space-y-6">
        <div>
          <PageBack href={backHref} label={calendarBack ? t("detail.backToCalendar") : importantDatesBackTitle(rawFrom, tList)} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 dir="auto" className="text-xl font-medium text-app-text-primary">{date.title}</h1>
              <p className="mt-1 text-sm text-app-text-secondary">
                <bdi>{date.client.name}</bdi> · {t(`category.${date.category}`)} · <bdi>{date.type}</bdi>
              </p>
            </div>
            <Drawer triggerLabel={t("detail.edit")} title={t("detail.editTitle")}>
              {/* Mapped, not passed whole - same reason as the list screen:
                  this is a client component, and listUsers() rows carry
                  passwordHash. */}
              <ImportantDateForm
                clients={clients.map((c) => ({ id: c.id, name: c.name }))}
                users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
                categories={categoriesForAutoTask}
                existing={{
                  id: date.id,
                  clientId: date.clientId,
                  title: date.title,
                  type: date.type,
                  category: date.category,
                  relatedEntityType: date.relatedEntityType,
                  relatedEntityName: date.relatedEntityName,
                  relationToClient: date.relationToClient,
                  calendarType: date.calendarType,
                  month: date.month,
                  day: date.day,
                  originYear: date.originYear,
                  recurrence: date.recurrence,
                  customIntervalDays: date.customIntervalDays,
                  onceDate: date.onceDate,
                  responsibleUserId: date.responsibleUserId,
                  extraEmailRecipients: date.extraEmailRecipients,
                  sensitivity: date.sensitivity,
                  notes: date.notes,
                  createAutoTask: date.createAutoTask,
                  autoTaskLeadDays: date.autoTaskLeadDays,
                  autoTaskCategoryId: date.autoTaskCategoryId,
                  weekday: date.weekday,
                  intervalMonths: date.intervalMonths,
                  leadUnit: date.leadUnit,
                  rollConvention: date.rollConvention,
                  businessCalendar: date.businessCalendar,
                  calendarLockedBy: calendarLine,
                  precision: date.precision,
                  dayAlternatives: date.dayAlternatives,
                  conditionText: date.conditionText,
                  expectsReceipt: date.expectsReceipt,
                  expectedFrom: date.expectedFrom,
                  rangeStart: date.rangeStart,
                  rangeEnd: date.rangeEnd,
                  updatedAt: date.updatedAt,
                }}
              />
            </Drawer>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-2xl border border-app-border bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-app-text-primary">{t("detail.details")}</h2>
                <StatusBadge label={t(`status.${date.status}`)} tone={STATUS_TONE[date.status]} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-app-text-tertiary">{t("detail.nextOccurrence")}</dt>
                  <dd className="text-app-text-primary">
                    {date.precision === "UNKNOWN" ? t("detail.missing") : formatDate(date.nextOccurrenceAt)}
                    {date.precision === "APPROXIMATE" && date.dayAlternatives.length > 1 && (
                      <span className="text-app-text-tertiary"> ({t("detail.approximate", { days: format.list([...new Set(date.dayAlternatives)].sort((a, b) => a - b).map(String), { type: "disjunction" }) })})</span>
                    )}
                  </dd>
                </div>
                {date.expectsReceipt && (
                  <div className="col-span-2">
                    <dt className="text-xs text-app-text-tertiary">{t("detail.receipt")}</dt>
                    <dd className="text-app-text-primary">{date.expectedFrom ? t("detail.receiptBodyFrom", { from: date.expectedFrom }) : t("detail.receiptBody")}</dd>
                  </div>
                )}
                {date.conditionText && (
                  <div className="col-span-2">
                    <dt className="text-xs text-app-text-tertiary">{t("detail.condition")}</dt>
                    <dd dir="auto" className="text-app-text-primary">{date.conditionText}</dd>
                  </div>
                )}
                {(date.rangeStart || date.rangeEnd) && (
                  <div className="col-span-2">
                    <dt className="text-xs text-app-text-tertiary">{t("detail.period")}</dt>
                    <dd className="text-app-text-primary">
                      {t("detail.periodRange", {
                        start: date.rangeStart ? formatDate(date.rangeStart) : t("detail.fromStart"),
                        end: date.rangeEnd ? formatDate(date.rangeEnd) : t("detail.noEnd"),
                      })}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-app-text-tertiary">{t("detail.responsible")}</dt>
                  <dd dir="auto" className="text-app-text-primary">{date.responsibleUser.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-app-text-tertiary">{t("detail.calendar")}</dt>
                  <dd className="text-app-text-primary">{date.calendarType === "HEBREW" ? t("detail.hebrew") : t("detail.gregorian")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-app-text-tertiary">{t("detail.businessDays")}</dt>
                  <dd className="text-app-text-primary" data-testid="date-business-calendar">
                    {calendarLine ?? t(`businessCalendar.${isBusinessCalendarKey(date.businessCalendar) ? date.businessCalendar : "IL"}`)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-app-text-tertiary">{t("detail.sensitivity")}</dt>
                  <dd className="text-app-text-primary">{date.sensitivity === "SENSITIVE" ? t("detail.sensitive") : t("detail.normal")}</dd>
                </div>
                {date.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs text-app-text-tertiary">{t("detail.notes")}</dt>
                    <dd dir="auto" className="text-app-text-primary">{date.notes}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-2xl border border-app-border bg-white p-6">
              <h2 className="text-sm font-medium text-app-text-primary">{t("detail.reminders")}</h2>
              {date.reminderRules.length === 0 ? (
                <p className="mt-2 text-sm text-app-text-tertiary">{t("detail.noReminders")}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {date.reminderRules.map((rule) => (
                    <li key={rule.id} className="flex items-center gap-3 text-sm text-app-text-secondary">
                      <span className="rounded-full bg-app-surface-sunken px-3 py-1 text-xs text-app-text-primary">{t("detail.daysBefore", { days: rule.daysBefore })}</span>
                      {rule.sendInApp && <span className="text-xs text-app-text-tertiary">{t("detail.inApp")}</span>}
                      {rule.sendEmail && <span className="text-xs text-app-text-tertiary">{t("detail.email")}</span>}
                      {!rule.enabled && <span className="text-xs text-app-error">{t("detail.disabled")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {ownTasks.length > 0 && (
              <div className="rounded-2xl border border-app-border bg-white p-6">
                <h2 className="text-sm font-medium text-app-text-primary">{t("detail.tasks")}</h2>
                <ul className="mt-3 space-y-1.5">
                  {ownTasks.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link href={`/app/tasks/${task.id}`} dir="auto" className="text-app-text-primary underline-offset-4 hover:underline">
                        {task.title}
                      </Link>
                      <span className="whitespace-nowrap text-xs text-app-text-tertiary">{tTask(`status.${task.status}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-app-border bg-white p-6" data-testid="date-start-work">
              <h2 className="text-sm font-medium text-app-text-primary">{t("detail.startWork")}</h2>
              {workTask ? (
                <>
                  <p className="mt-1 text-xs text-app-text-tertiary">
                    {t.rich("detail.workIn", {
                      title: workTask.title,
                      task: (chunks) => (
                        <Link href={`/app/tasks/${workTask.id}`} dir="auto" className="text-app-text-secondary underline underline-offset-4">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                  <div className="mt-3">
                    {workPrompt ? (
                      <AdvanceWithClaude taskId={workTask.id} prompt={workPrompt} hasPlan={workPlan !== null} />
                    ) : (
                      <p className="text-xs text-app-text-secondary">
                        {workDetail ? t("detail.noAi") : t("detail.noAccess")}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-xs text-app-text-tertiary">{t("detail.startWorkHint")}</p>
                  <form action={startWorkOnImportantDateAction} className="mt-3">
                    <input type="hidden" name="importantDateId" value={date.id} />
                    <input type="hidden" name="from" value={fromParam} />
                    <button type="submit" className="inline-flex items-center rounded-full bg-app-accent px-4 py-2.5 text-sm font-medium text-app-text-primary">
                      {t("detail.startWork")}
                    </button>
                  </form>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-app-border bg-white p-6">
              <h2 className="text-sm font-medium text-app-text-primary">{t("detail.status")}</h2>
              <div className="mt-3">
                <ImportantDateStatusSelect importantDateId={date.id} status={date.status} />
              </div>
            </div>

            <div className="rounded-2xl border border-app-border bg-white p-6">
              <h2 className="text-sm font-medium text-app-text-primary">{t("detail.snooze")}</h2>
              <p className="mt-1 text-xs text-app-text-tertiary">{t("detail.snoozeHint")}</p>
              <form action={snoozeImportantDateAction} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="importantDateId" value={date.id} />
                <input
                  type="date"
                  name="snoozedUntil"
                  required
                  className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
                />
                <button type="submit" className="whitespace-nowrap rounded-full border border-app-border px-4 py-2 text-sm text-app-text-primary hover:border-gold">
                  {t("detail.snoozeButton")}
                </button>
              </form>
            </div>

            <div className="rounded-2xl border border-app-border bg-white p-6">
              <h2 className="text-sm font-medium text-app-text-primary">{t("detail.delete")}</h2>
              <p className="mt-1 text-xs text-app-text-tertiary">{t("detail.deleteHint")}</p>
              <form action={deleteImportantDateAction} className="mt-3">
                <input type="hidden" name="importantDateId" value={date.id} />
                <button type="submit" className="rounded-full border border-app-error/30 px-4 py-2 text-sm text-app-error hover:bg-app-error-soft">
                  {t("detail.deleteButton")}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
