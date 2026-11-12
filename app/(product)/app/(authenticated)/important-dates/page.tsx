import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { timed } from "@/lib/slow-log";
import { can } from "@/lib/app-auth/permissions";
import { listImportantDates } from "@/lib/app-domain/important-dates";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listUsers } from "@/lib/app-domain/users";
import { listCategories } from "@/lib/app-domain/categories";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { ImportantDateForm } from "./ImportantDateForm";
import { IMPORTANT_DATES_LIST_KEYS, listQueryOf } from "@/lib/list-back";
import { ImportantDateRow, type DateRow } from "./ImportantDateRow";
import type { ImportantDateStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

type Tab = "upcoming" | "all" | "done";

/// Their names are importantDates.list.tabs.<tab> (ADR 0006).
const TABS: Tab[] = ["upcoming", "all", "done"];

const STATUS_TONE: Record<ImportantDateStatus, DateRow["tone"]> = {
  ACTIVE: "gray",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "gold",
  HANDLED_CURRENT: "green",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

// App redesign (handoff README, screen 7 "מועדים חשובים"): "מתג: קרובים /
// הכל / טופלו" - replaces the previous list/calendar toggle and the
// clientId/category/status filter bar with the prototype's single 3-way
// tab, matching its markup exactly (date-square row, no KPI cards, no
// filter form). Same scope-reduction call as tasks/page.tsx made in the
// daily-screens phase: listImportantDates() still accepts clientId/
// category/status filters server-side, and the calendar grouping this
// replaced is straightforward to bring back from history if ever
// requested - this pass follows the design spec's exact, deliberately
// simpler surface rather than preserving every prior filter control.
export default async function ImportantDatesPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const t = await getTranslations("importantDates.list");
  const format = await getFormatter();
  // "תזכורת: 7, 1 ימים מראש", or "ללא תזכורות".
  const formatReminders = (rules: { daysBefore: number }[]): string => {
    if (rules.length === 0) return t("noReminders");
    const days = [...new Set(rules.map((r) => r.daysBefore))].sort((a, b) => a - b);
    return t("reminders", { days: days.join(", ") });
  };

  const tab: Tab = searchParams.tab === "all" ? "all" : searchParams.tab === "done" ? "done" : "upcoming";
  // Carried to each date, so its way back returns to this tab (lib/list-back.ts).
  const listQuery = listQueryOf(searchParams, IMPORTANT_DATES_LIST_KEYS);

  // The last unmeasured segment of the chain. Every write on this screen
  // revalidates it, and Next ships that re-render back inside the action's
  // own response - so if the wait is here, the button that triggered it is
  // what looks slow. See lib/slow-log.ts.
  const [dates, clients, users, allCategories] = await timed("screen.important-dates.load", () =>
    Promise.all([listImportantDates(user), listAccessibleClients(user), listUsers(), listCategories()])
  );

  const clientIds = new Set(clients.map((c) => c.id));
  const categoriesForAutoTask = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  const visible = dates.filter((d) => {
    if (tab === "done") return d.status === "HANDLED_CURRENT";
    if (tab === "all") return true;
    return d.status !== "HANDLED_CURRENT" && d.status !== "ARCHIVED";
  });

  const rows: DateRow[] = visible.map((d) => {
    const occurrence = d.nextOccurrenceAt ?? d.createdAt;
    return {
      id: d.id,
      title: d.title,
      // Org-brain spec 3.10: a date with an unknown day is a gap, and the
      // list says so instead of showing the day it was created.
      day: d.precision === "UNKNOWN" ? "?" : format.dateTime(occurrence, { day: "2-digit" }),
      month: d.precision === "UNKNOWN" ? t("missingMonth") : format.dateTime(occurrence, { month: "short" }),
      meta: [
        d.client.name,
        t(`recurrence.${d.recurrence}`),
        d.precision === "APPROXIMATE" && d.dayAlternatives.length > 1
          ? t("approximate", { days: format.list([...new Set(d.dayAlternatives)].sort((a, b) => a - b).map(String), { type: "disjunction" }) })
          : null,
        d.precision === "UNKNOWN" ? t("missing") : null,
        d.conditionText ? t("conditional") : null,
        d.expectsReceipt ? (d.expectedFrom ? t("receiptFrom", { from: d.expectedFrom }) : t("receipt")) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      tag: t(`status.${d.status}`),
      tone: STATUS_TONE[d.status],
      remind: formatReminders(d.reminderRules),
      status: d.status,
      previousStatus: d.status === "HANDLED_CURRENT" ? "ACTIVE" : d.status,
    };
  });

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
            <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
          </div>
          <Drawer triggerLabel={t("newTrigger")} title={t("newTitle")}>
            {/* `users` is mapped down to the three fields the form declares,
                not passed whole. ImportantDateForm is a client component, so
                whatever reaches it is serialised into this page's HTML - and
                listUsers() returns full User rows, passwordHash included.
                TypeScript does not catch this: a variable (unlike an object
                literal) is allowed to carry extra properties past a narrower
                prop type, so the types looked right while every user's bcrypt
                hash shipped to the browser on this screen. */}
            <ImportantDateForm
              clients={clients.map((c) => ({ id: c.id, name: c.name }))}
              users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
              categories={categoriesForAutoTask}
            />
          </Drawer>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-app-border bg-white p-[3px]">
            {TABS.map((value) => (
              <a
                key={value}
                href={value === "upcoming" ? "/app/important-dates" : `/app/important-dates?tab=${value}`}
                className={`rounded-full px-4 py-2 text-[13px] transition-colors ${
                  tab === value ? "bg-app-surface-nav text-cream font-medium" : "text-app-text-secondary hover:text-app-text-primary"
                }`}
              >
                {t(`tabs.${value}`)}
              </a>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {rows.length === 0 ? (
            <p className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
              {t("empty")}
            </p>
          ) : (
            rows.map((row) => <ImportantDateRow key={row.id} date={row} listQuery={listQuery} />)
          )}
        </div>

        <p className="text-xs text-app-text-tertiary">{t("footnote")}</p>
      </div>
    </>
  );
}
