import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getImportantDate } from "@/lib/app-domain/important-dates";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listUsers } from "@/lib/app-domain/users";
import { listCategories } from "@/lib/app-domain/categories";
import { IMPORTANT_DATE_CATEGORY_LABELS } from "@/lib/app-domain/important-dates-reminders";
import { IMPORTANT_DATE_STATUS_LABELS } from "@/lib/app-domain/important-dates";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Drawer } from "@/components/app/Drawer";
import { ImportantDateForm } from "../ImportantDateForm";
import { ImportantDateStatusSelect } from "../ImportantDateStatusSelect";
import { snoozeImportantDateAction, deleteImportantDateAction } from "../actions";
import type { ImportantDateStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_TONE: Record<ImportantDateStatus, "green" | "amber" | "gray" | "red"> = {
  ACTIVE: "green",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "amber",
  HANDLED_CURRENT: "gray",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

export default async function ImportantDateDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const clientIds = new Set(clients.map((c) => c.id));
  const categoriesForAutoTask = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  return (
    <>
      <div className="space-y-6">
        <div>
          <Link href="/app/important-dates" className="text-xs text-navy/50 hover:text-gold-dim">
            ← חזרה למועדים חשובים
          </Link>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-medium text-navy">{date.title}</h1>
              <p className="mt-1 text-sm text-navy/60">
                {date.client.name} · {IMPORTANT_DATE_CATEGORY_LABELS[date.category]} · {date.type}
              </p>
            </div>
            <Drawer triggerLabel="עריכה" title="עריכת מועד חשוב">
              <ImportantDateForm
                clients={clients}
                users={users}
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
                  updatedAt: date.updatedAt,
                }}
              />
            </Drawer>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-navy">פרטים</h2>
                <StatusBadge label={IMPORTANT_DATE_STATUS_LABELS[date.status]} tone={STATUS_TONE[date.status]} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-navy/50">מופע הבא</dt>
                  <dd className="text-navy">{formatDate(date.nextOccurrenceAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-navy/50">אחראי</dt>
                  <dd className="text-navy">{date.responsibleUser.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-navy/50">לוח שנה</dt>
                  <dd className="text-navy">{date.calendarType === "HEBREW" ? "עברי" : "לועזי"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-navy/50">רגישות</dt>
                  <dd className="text-navy">{date.sensitivity === "SENSITIVE" ? "רגיש" : "רגיל"}</dd>
                </div>
                {date.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs text-navy/50">הערות</dt>
                    <dd className="text-navy">{date.notes}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <h2 className="text-sm font-medium text-navy">תזכורות</h2>
              {date.reminderRules.length === 0 ? (
                <p className="mt-2 text-sm text-navy/50">אין תזכורות מוגדרות למועד זה.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {date.reminderRules.map((rule) => (
                    <li key={rule.id} className="flex items-center gap-3 text-sm text-navy/70">
                      <span className="rounded-full bg-navy/5 px-3 py-1 text-xs text-navy">{rule.daysBefore} ימים לפני</span>
                      {rule.sendInApp && <span className="text-xs text-navy/50">בתוך המערכת</span>}
                      {rule.sendEmail && <span className="text-xs text-navy/50">מייל</span>}
                      {!rule.enabled && <span className="text-xs text-red-600">מושבת</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {date.tasks.length > 0 && (
              <div className="rounded-2xl border border-lineDark bg-white p-6">
                <h2 className="text-sm font-medium text-navy">משימות שנוצרו אוטומטית</h2>
                <ul className="mt-3 space-y-1.5">
                  {date.tasks.map((task) => (
                    <li key={task.id} className="text-sm text-navy/70">
                      {task.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <h2 className="text-sm font-medium text-navy">סטטוס</h2>
              <div className="mt-3">
                <ImportantDateStatusSelect importantDateId={date.id} status={date.status} />
              </div>
            </div>

            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <h2 className="text-sm font-medium text-navy">דחיית טיפול (Snooze)</h2>
              <p className="mt-1 text-xs text-navy/50">דוחה את הטיפול מבלי לשנות את תאריך האירוע המקורי.</p>
              <form action={snoozeImportantDateAction} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="importantDateId" value={date.id} />
                <input
                  type="date"
                  name="snoozedUntil"
                  required
                  className="w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
                />
                <button type="submit" className="whitespace-nowrap rounded-full border border-lineDark px-4 py-2 text-sm text-navy hover:border-gold">
                  דחייה
                </button>
              </form>
            </div>

            <div className="rounded-2xl border border-lineDark bg-white p-6">
              <h2 className="text-sm font-medium text-navy">מחיקה</h2>
              <p className="mt-1 text-xs text-navy/50">מעביר לארכיון רך - ניתן לשחזר דרך בסיס הנתונים אם צריך.</p>
              <form action={deleteImportantDateAction} className="mt-3">
                <input type="hidden" name="importantDateId" value={date.id} />
                <button type="submit" className="rounded-full border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  מחיקת מועד
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
