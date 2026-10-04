import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listMyTimeEntries } from "@/lib/app-domain/time-entries";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { Forbidden } from "@/components/app/Forbidden";
import { ManualEntryForm } from "./ManualEntryForm";
import { EntryRow } from "./EntryRow";
import { addDaysToKey, dayStartInZone, weekdayOfKey } from "@/lib/timezone";

export const metadata = { robots: { index: false, follow: false } };

const TIMEZONE = "Asia/Jerusalem";

// App redesign (handoff README, screen 3 "הזמן שלי"): "סה״כ מול יעד" in
// the week strip's header. No per-user weekly-target setting exists
// anywhere in the domain (nothing in prisma/schema.prisma, no
// lib/app-domain config for it) - this is a fixed, generic full-time-week
// reference point (not a personalized target), same spirit as
// LONG_TIMER_HOURS elsewhere: a single named constant a future
// admin-configurable version can replace.
const WEEKLY_TARGET_HOURS = 40;
// Reference used to scale each day-strip cell's intensity bar - a "full"
// 8-hour day reads as fully saturated gold, half a day half as much.
const FULL_DAY_HOURS = 8;

// The week is Israel's (28.9.2026). These used to build midnight with
// `new Date(\`${key}T00:00:00\`)`, which is the SERVER's midnight: on
// Vercel (UTC) the week started at 03:00 on Sunday Israel time, so work
// logged between midnight and three landed in the previous week. Days are
// now counted on the date key and turned into instants at Israel's
// midnight, so a DST change cannot shift a day either.

/// The Sunday (Israeli work week, Sunday = 0) of the week holding `key`.
function weekStartKey(key: string): string {
  return addDaysToKey(key, -weekdayOfKey(key));
}

/// Israel's midnight at the start of a `YYYY-MM-DD` day.
function dayStart(key: string): Date {
  return dayStartInZone(key) as Date;
}

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "short", timeZone: TIMEZONE }).format(
    date
  );
}

function formatDayShort(date: Date): { weekday: string; dayMonth: string } {
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "narrow", timeZone: TIMEZONE }).format(date);
  const dayMonth = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: TIMEZONE }).format(
    date
  );
  return { weekday, dayMonth };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "פעיל";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Spec 11 "My Time": "רשימת entries לפי יום/שבוע, actual+billable לפי
// permission, edit."
export default async function MyTimePage(props: { searchParams: Promise<{ week?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const anchorKey =
    searchParams.week && dayStartInZone(searchParams.week) ? searchParams.week : dateKey(new Date());
  const startKey = weekStartKey(anchorKey);
  const weekStart = dayStart(startKey);
  const weekEnd = dayStart(addDaysToKey(startKey, 7));
  const prevWeek = addDaysToKey(startKey, -7);
  const nextWeek = addDaysToKey(startKey, 7);
  const todayKeyStr = dateKey(new Date());

  const [entries, clients, allCategories] = await Promise.all([
    listMyTimeEntries(user.id, { from: weekStart, to: weekEnd }),
    listAccessibleClients(user),
    listCategories(),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  const categories = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  const byDay = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = dateKey(entry.startAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(entry);
  }
  // Noon rather than midnight for each day's instant: every formatter on
  // this screen reads the date in Israel's zone, and noon is the same
  // calendar day there whatever the offset that day is.
  const days = Array.from({ length: 7 }, (_, i) => new Date(dayStart(addDaysToKey(startKey, i)).getTime() + 12 * 3600_000));
  const weekTotalSeconds = entries.reduce((sum, e) => sum + (e.actualSeconds ?? 0), 0);

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">הזמן שלי</h1>
          <p className="mt-1 text-sm text-appNavy/60">רצועת השבוע, הוספת דיווח בשורה אחת, ורשימה לפי יום.</p>
        </div>

        {/* App redesign (handoff README, screen 3): "פס שבוע" - nav +
            total-vs-target header, then a 7-cell day strip with today
            outlined in gold. */}
        <div className="rounded-2xl border border-lineDark bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Link
                href={`/app/my-time?week=${prevWeek}`}
                aria-label="שבוע קודם"
                className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-lineDark text-appNavy hover:border-gold"
              >
                ›
              </Link>
              <span className="text-[13.5px] font-medium text-appNavy">
                {formatDay(days[0])} - {formatDay(days[6])}
              </span>
              <Link
                href={`/app/my-time?week=${nextWeek}`}
                aria-label="שבוע הבא"
                className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-lineDark text-appNavy hover:border-gold"
              >
                ‹
              </Link>
            </div>
            <span className="text-[12.5px] text-appNavy/60">
              סה&quot;כ השבוע{" "}
              <span className="font-jbmono text-sm text-appNavy">{formatDuration(weekTotalSeconds)}</span> · יעד{" "}
              {WEEKLY_TARGET_HOURS}:00
            </span>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-2">
            {days.map((day) => {
              const key = dateKey(day);
              const daySeconds = (byDay.get(key) ?? []).reduce((sum, e) => sum + (e.actualSeconds ?? 0), 0);
              const isToday = key === todayKeyStr;
              const { weekday, dayMonth } = formatDayShort(day);
              const intensity = Math.min(1, daySeconds / (FULL_DAY_HOURS * 3600));
              return (
                <div
                  key={key}
                  className={`rounded-xl p-2.5 text-center ${
                    isToday ? "border-2 border-gold bg-gold/6" : "border border-lineDark"
                  }`}
                >
                  <span className={`block text-[11px] ${isToday ? "text-gold-dim" : "text-appNavy/50"}`}>
                    {weekday}׳ {dayMonth}
                  </span>
                  <span
                    className={`mt-1.5 block font-jbmono text-sm ${
                      isToday ? "font-medium text-appNavy" : daySeconds > 0 ? "text-appNavy" : "text-appNavy/35"
                    }`}
                  >
                    {daySeconds > 0 ? formatDuration(daySeconds) : "—"}
                  </span>
                  <span
                    className="mt-2 block h-[3px] rounded-full"
                    style={{
                      background: daySeconds > 0 ? `rgba(176,141,87,${Math.max(0.4, intensity).toFixed(2)})` : "rgba(27,42,61,0.1)",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* App redesign (handoff README, screen 3): "הזנה בשורה אחת -
            במקום טופס נפתח" - always visible, flex-wrap so it never
            collapses into fixed columns in a narrow window. */}
        <ManualEntryForm
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          categories={categories.map((cat) => ({ id: cat.id, name: cat.name, clientId: cat.clientId }))}
        />

        {/* Hadas, 23.9.2026: "יום עבודה נוכחי ראשון". Newest day on top,
            which also matches the order inside each day (startAt desc). The
            strip above stays Sunday to Saturday: it is a calendar. */}
        <div className="space-y-4">
          {[...days].reverse().map((day) => {
            const key = dateKey(day);
            const dayEntries = byDay.get(key) ?? [];
            if (dayEntries.length === 0) return null;
            const dayTotalSeconds = dayEntries.reduce((sum, e) => sum + (e.actualSeconds ?? 0), 0);
            // Billed total next to the worked total, only when they differ
            // (a client with a minimum or rounding policy). The weekly strip
            // and target stay on actual time: that is hours worked, not hours
            // billed.
            const dayBillableSeconds = dayEntries.reduce((sum, e) => sum + (e.billableSeconds ?? 0), 0);
            const dayClosedActualSeconds = dayEntries.reduce(
              (sum, e) => sum + (e.endAt ? (e.actualSeconds ?? 0) : 0),
              0
            );
            return (
              <div key={key} className="rounded-2xl border border-lineDark bg-white">
                <div className="flex items-center justify-between border-b border-lineDark bg-cream px-5 py-3">
                  <p className="text-sm font-medium text-appNavy">{formatDay(day)}</p>
                  <span className="text-sm text-appNavy">
                    <span className="font-jbmono">{formatDuration(dayTotalSeconds)}</span>
                    {dayBillableSeconds !== dayClosedActualSeconds && (
                      <span className="ms-2 text-[12px] text-gold-dim" data-testid="day-billable">
                        לחיוב <span className="font-jbmono">{formatDuration(dayBillableSeconds)}</span>
                      </span>
                    )}
                  </span>
                </div>
                <div className="divide-y divide-lineDark">
                  {dayEntries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={{
                        id: entry.id,
                        startAt: entry.startAt.toISOString(),
                        endAt: entry.endAt?.toISOString() ?? null,
                        actualSeconds: entry.actualSeconds,
                        billableSeconds: entry.billableSeconds,
                        note: entry.note,
                        isEdited: entry.isEdited,
                        isManual: entry.isManual,
                        isOverlapConfirmed: entry.isOverlapConfirmed,
                        clientName: entry.client.name,
                        categoryName: entry.category.name,
                        updatedAt: entry.updatedAt.toISOString(),
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="rounded-2xl border border-lineDark bg-white p-8 text-center">
              <p className="text-sm text-appNavy/50">אין עדיין דיווחים השבוע.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
