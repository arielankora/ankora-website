import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalHome } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { whatsappHref } from "@/lib/whatsapp";
import { ExpandablePromiseRow, PromiseList } from "./PromiseList";
import { portalHeadline } from "@/lib/app-domain/portal-labels";
import { bankFigures, packageFigures } from "@/lib/hours-format";
import { forecastCell } from "@/lib/prepaid-format";
import type { PortalPromise } from "@/lib/app-domain/client-portal";

function monthName(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", timeZone: "Asia/Jerusalem" }).format(date);
}

/// One group inside the monthly summary card: a heading with its count,
/// and rows that open in place.
function MonthGroup({
  title,
  promises,
  minutesByTask,
  emptyText,
  showStage,
}: {
  title: string;
  promises: PortalPromise[];
  minutesByTask: Record<string, number>;
  emptyText: string;
  showStage: boolean;
}) {
  return (
    <div>
      <p className="bg-app-surface-sunken px-[18px] py-2 text-[12px] font-medium text-app-text-secondary">
        {title} <span className="font-jbmono">({promises.length})</span>
      </p>
      {promises.length === 0 ? (
        <p className="px-[18px] py-4 text-[13px] text-app-text-tertiary">{emptyText}</p>
      ) : (
        <div className="divide-y divide-app-border">
          {promises.map((p) => (
            <ExpandablePromiseRow key={p.id} promise={p} minutesThisMonth={minutesByTask[p.id] ?? 0} showStage={showStage} />
          ))}
        </div>
      )}
    </div>
  );
}

export const metadata = { robots: { index: false, follow: false } };


// Portal phase 1, the home screen.
//
// The screen answers three questions in the order a person asks them:
// is something waiting for me, what is being handled, and what was
// finished. The hour bank, which used to be the first thing on this
// screen, is now one quiet line at the bottom with a link - it is the
// answer to a question the client asks monthly, not on every visit.
//
// The design's screen 16 had a fourth block here, a card for the account
// manager with a WhatsApp button. It is not built yet on purpose: the
// Client model has no owner field, so every version of that card would
// have had to invent a name. It arrives with phase 2, which needs the
// same relationship for decisions.
export default async function PortalHomePage() {
  const user = await requireUser();

  let home;
  try {
    home = await getPortalHome(user);
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden />;
    throw err;
  }

  const { client, waitingOnClient, inProgress, month, cycle, openDecisions, contact, isStaffPreview } = home;
  const waHref = whatsappHref(contact.whatsappNumber);
  const openCount = inProgress.length + waitingOnClient.length;

  return (
    <div className="space-y-4">
      {/* 20.10.2026 (canvas, portal boards): one action at the top. When a
          decision waits, the headline says so and one gold button leads
          there; otherwise the headline is the whole message. */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-app-border bg-white p-6 sm:p-7">
        <div>
          <p className="text-[13.5px] text-app-text-secondary">שלום, {client.name}</p>
          <p className="mt-1.5 text-xl font-medium text-app-text-primary">
            {portalHeadline(openDecisions, waitingOnClient.length, inProgress.length)}
          </p>
        </div>
        {openDecisions > 0 && (
          <Link
            href="/app/portal/decisions"
            data-testid="portal-home-decisions"
            className="rounded-full bg-app-accent px-5 py-3 text-sm font-medium text-app-text-primary hover:opacity-90"
          >
            {openDecisions === 1 ? "לצפייה בהחלטה" : `לצפייה ב-${openDecisions} החלטות`}
          </Link>
        )}
      </div>

      {/* Staff preview only. Finished work nobody marked visible is the
          most common reason this screen looks emptier than the team's own
          view of the month, and the person previewing can fix it. */}
      {isStaffPreview && month.hiddenDone > 0 && (
        <div className="rounded-[14px] border border-gold/40 bg-gold/10 px-4 py-3 text-[12.5px] text-app-text-primary" data-testid="portal-hidden-done">
          {month.hiddenDone === 1
            ? "משימה אחת הושלמה החודש ולא סומנה כגלויה ללקוח, ולכן היא לא מופיעה כאן."
            : `${month.hiddenDone} משימות הושלמו החודש ולא סומנו כגלויות ללקוח, ולכן הן לא מופיעות כאן.`}{" "}
          כדי שיופיעו, סמנו אותן כגלויות ללקוח במסך המשימה.
        </div>
      )}

      {/* "מחכה לך", not "מחכה להחלטה שלך".
          These are promises in flight that need something from the
          client - an answer, a document, a key. They are not
          decisions, and the decisions tab does not list them. Calling
          them decisions sent a client to that tab to be told nothing
          was waiting, which is the fastest way to teach someone the
          portal is not accurate. The wording here is the same stage
          label they read on every other screen. */}
      {waitingOnClient.length > 0 && (
        <PromiseList title="מחכה לך" promises={waitingOnClient} tone="attention" showStage={false} />
      )}

      {/* 3.11.2026 (Hadas's review): "מה טיפלנו בו החודש". Replaces both the
          empty state, which told a client with five finished tasks in their
          monthly report that the first item would arrive within a working
          day, and the two lists that stood here ("בטיפול עכשיו", "נסגר
          לאחרונה"). The finished count is the monthly report's own number
          (doneInPeriodWhere), so the two screens can no longer disagree. */}
      <div className="overflow-hidden rounded-2xl border border-app-border bg-white" data-testid="portal-month-summary">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-app-border px-[18px] py-3.5">
          <span className="text-[13.5px] font-medium text-app-text-primary">מה טיפלנו בו ב{monthName(month.from)}</span>
          <Link href="/app/portal/activity" className="text-xs text-app-text-accent hover:underline">
            כל הפעילות
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-app-border px-[18px] py-3.5">
          <div>
            <p className="text-[11.5px] text-app-text-secondary">הושלמו החודש</p>
            <p className="mt-1 font-jbmono text-xl text-app-text-primary">{month.done.length}</p>
          </div>
          <div>
            <p className="text-[11.5px] text-app-text-secondary">פתוחות</p>
            <p className="mt-1 font-jbmono text-xl text-app-text-primary">{openCount}</p>
          </div>
        </div>
        <MonthGroup
          title="הושלמו החודש"
          promises={month.done}
          minutesByTask={month.minutesByTask}
          emptyText="עוד לא הושלמו משימות החודש."
          showStage={false}
        />
        <MonthGroup
          title="בטיפול"
          promises={inProgress}
          minutesByTask={month.minutesByTask}
          emptyText="אין כרגע משימות בטיפול."
          showStage
        />
      </div>

      {/* 20.10.2026: the account manager and the hours side by side, two cards
          in one row on a wide screen, one under the other on a phone. */}
      <div className={`grid grid-cols-1 gap-4 ${(contact.managerName || waHref) && cycle ? "sm:grid-cols-2" : ""}`}>
        {/* Portal phase 2: who to talk to. Last on the screen because it is
            the answer to "and if I want a person", not the first thing a
            client needs - but always present, because a portal without a
            name on it is a system, and Ankora is not selling a system. */}
        {(contact.managerName || waHref) && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-app-border bg-white px-[18px] py-3.5">
            <span className="text-[12.5px] text-app-text-secondary">
              {contact.managerName ? `מנהל התיק שלך: ${contact.managerName}` : "מנהל התיק שלך ב-Ankora"}
            </span>
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-app-border-strong px-3.5 py-1.5 text-xs text-app-text-primary hover:border-app-accent"
              >
                וואטסאפ
              </a>
            ) : (
              <span className="text-xs text-app-text-tertiary">וואטסאפ: זמין בקרוב</span>
            )}
          </div>
        )}

        {cycle && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-app-border bg-white px-[18px] py-3.5">
            <span className="text-[12.5px] text-app-text-secondary">
              {/* A bank reads in decimal hours everywhere (3.10.2026), the same
                  figures the client sees on the hours screen one click away. */}
              {cycle.kind === "PREPAID" ? (
                <>
                  חבילת השעות: נוצלו{" "}
                  <bdi dir="ltr">{packageFigures(cycle.purchasedMinutes, cycle.remainingMinutes).consumed}</bdi> מתוך{" "}
                  <bdi dir="ltr">{packageFigures(cycle.purchasedMinutes, cycle.remainingMinutes).total}</bdi> שעות
                  {cycle.forecast?.status === "projected" && ` · צפויה להספיק עד ${forecastCell(cycle.forecast, client.timezone)}`}
                  {cycle.forecast?.status === "depleted" && " · החבילה נוצלה"}
                </>
              ) : (
                <>
                  מחזור השעות הנוכחי: <bdi dir="ltr">{bankFigures(cycle.totalMinutes, cycle.usedMinutes).consumed}</bdi> מתוך{" "}
                  <bdi dir="ltr">{bankFigures(cycle.totalMinutes, cycle.usedMinutes).total}</bdi> שעות
                </>
              )}
              {cycle.daysLeft !== null && ` · ${cycle.daysLeft} ימים לסיום`}
            </span>
            <Link href="/app/portal/hours" className="text-xs text-app-text-accent hover:underline">
              פירוט השעות
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
