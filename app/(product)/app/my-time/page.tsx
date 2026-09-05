import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listMyTimeEntries } from "@/lib/app-domain/time-entries";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ManualEntryForm } from "./ManualEntryForm";
import { EntryRow } from "./EntryRow";

export const metadata = { robots: { index: false, follow: false } };

const TIMEZONE = "Asia/Jerusalem";

function startOfWeek(date: Date): Date {
  // Israeli work-week convention: Sunday is day 0.
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
  const d = new Date(`${key}T00:00:00`);
  const dow = d.getDay();
  d.setDate(d.getDate() - dow);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "short", timeZone: TIMEZONE }).format(
    date
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "פעיל";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Spec 11 "My Time": "רשימת entries לפי יום/שבוע, actual+billable לפי
// permission, edit."
export default async function MyTimePage({ searchParams }: { searchParams: { week?: string } }) {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const anchor = searchParams.week ? new Date(`${searchParams.week}T00:00:00`) : new Date();
  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 7);
  const prevWeek = dateKey(addDays(weekStart, -7));
  const nextWeek = dateKey(addDays(weekStart, 7));

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
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekTotalSeconds = entries.reduce((sum, e) => sum + (e.actualSeconds ?? 0), 0);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-medium text-navy">הזמן שלי</h1>
            <p className="mt-1 text-sm text-navy/60">
              {formatDay(weekStart)} – {formatDay(addDays(weekStart, 6))} · סה&quot;כ {formatDuration(weekTotalSeconds)}
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href={`/app/my-time?week=${prevWeek}`} className="text-navy/60 hover:text-navy">
              השבוע הקודם
            </Link>
            <Link href={`/app/my-time?week=${nextWeek}`} className="text-navy/60 hover:text-navy">
              השבוע הבא
            </Link>
          </div>
        </div>

        <ManualEntryForm
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          categories={categories.map((cat) => ({ id: cat.id, name: cat.name, clientId: cat.clientId }))}
        />

        <div className="space-y-4">
          {days.map((day) => {
            const key = dateKey(day);
            const dayEntries = byDay.get(key) ?? [];
            if (dayEntries.length === 0) return null;
            return (
              <div key={key} className="rounded-2xl border border-lineDark bg-white">
                <div className="border-b border-lineDark px-5 py-3">
                  <p className="text-sm font-medium text-navy">{formatDay(day)}</p>
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
                        note: entry.note,
                        isEdited: entry.isEdited,
                        isManual: entry.isManual,
                        clientName: entry.client.name,
                        categoryName: entry.category.name,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="rounded-2xl border border-lineDark bg-white p-8 text-center">
              <p className="text-sm text-navy/50">אין עדיין דיווחים השבוע.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
