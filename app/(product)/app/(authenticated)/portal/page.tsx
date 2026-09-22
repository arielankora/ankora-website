import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalHome } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { whatsappHref } from "@/lib/whatsapp";
import { PortalTabs } from "./PortalTabs";
import { PromiseList } from "./PromiseList";

export const metadata = { robots: { index: false, follow: false } };

function formatMinutes(minutes: number) {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/// The one sentence at the top of the portal. It is the whole product in
/// a line: either something needs the client, or nothing does.
///
/// Phase 2 put decisions ahead of waiting promises in it. Both are "you
/// are holding this", but a decision has options and a price and a real
/// cost to leaving it - a promise waiting on an answer is usually
/// downstream of one.
function headline(decisions: number, waiting: number, inProgress: number): string {
  const needsYou = decisions + waiting;
  if (decisions === 1 && waiting === 0) return "החלטה אחת מחכה לך.";
  if (decisions > 1 && waiting === 0) return `${decisions} החלטות מחכות לך.`;
  if (needsYou === 1) return "דבר אחד מחכה להחלטה שלך.";
  if (needsYou > 1) return `${needsYou} דברים מחכים להחלטה שלך.`;
  if (inProgress === 0) return "הכל מטופל. אין כרגע דבר שדורש פעולה מצדך.";
  if (inProgress === 1) return "הבטחה אחת בטיפול. אין דבר שמחכה לך.";
  return `${inProgress} הבטחות בטיפול. אין דבר שמחכה לך.`;
}

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

  const { client, waitingOnClient, inProgress, recentlyDone, cycle, openDecisions, contact } = home;
  const nothingYet =
    openDecisions === 0 && waitingOnClient.length === 0 && inProgress.length === 0 && recentlyDone.length === 0;
  const waHref = whatsappHref(contact.whatsappNumber);

  return (
    <div className="space-y-4">
      <PortalTabs active="home" />

      <div className="rounded-[20px] border border-gold/28 bg-[#FBF7F0] p-6 sm:p-7">
        <p className="text-xl font-medium text-appNavy">שלום, {client.name}</p>
        <p className="mt-1.5 text-[13.5px] text-appNavy/60">
          {headline(openDecisions, waitingOnClient.length, inProgress.length)}
        </p>
      </div>

      {nothingYet ? (
        // The empty state of a brand-new client, and the one place the
        // portal explains itself. Written as a promise with a date on it
        // rather than as a tour: "here is what will appear, and when".
        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <p className="text-[13.5px] font-medium text-appNavy">כאן יופיע מה שאנחנו מטפלים בו עבורך</p>
          <ul className="mt-3 space-y-2 text-sm text-appNavy/65">
            <li>כל בקשה שנכנסת מופיעה כאן ברגע שהיא מתקבלת אצלנו.</li>
            <li>כשמשהו מחכה להחלטה שלך, הוא יעלה לראש המסך.</li>
            <li>מה שהושלם נשאר כאן, עם התאריך.</li>
          </ul>
          <p className="mt-4 text-[12.5px] text-appNavy/50">
            הפריט הראשון שלך יופיע כאן תוך יום עבודה. בינתיים, כל בקשה נשלחת כרגיל בוואטסאפ למנהל התיק.
          </p>
        </div>
      ) : (
        <>
          {/* Portal phase 2. A link, not the cards themselves: a decision
              needs its options and its price to be answered properly, and
              a home screen that tries to hold them stops being a summary.
              The count is the whole message. */}
          {openDecisions > 0 && (
            <Link
              href="/app/portal/decisions"
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-gold/45 bg-[#FBF7F0] px-[18px] py-4 transition-colors hover:border-gold"
            >
              <span className="text-[13.5px] font-medium text-appNavy">
                {openDecisions === 1 ? "החלטה אחת מחכה לך" : `${openDecisions} החלטות מחכות לך`}
              </span>
              <span className="text-xs text-gold-dim">לצפייה והחלטה</span>
            </Link>
          )}

          {waitingOnClient.length > 0 && (
            <PromiseList title="מחכה להחלטה שלך" promises={waitingOnClient} tone="attention" showStage={false} />
          )}

          <PromiseList
            title="בטיפול עכשיו"
            promises={inProgress}
            emptyText="אין כרגע הבטחות פתוחות."
            showStage={false}
          />

          <PromiseList
            title="נסגר לאחרונה"
            promises={recentlyDone}
            action={
              <Link href="/app/portal/activity" className="text-xs text-gold-dim hover:underline">
                כל הפעילות
              </Link>
            }
            showStage={false}
          />
        </>
      )}

      {/* Portal phase 2: who to talk to. Last on the screen because it is
          the answer to "and if I want a person", not the first thing a
          client needs - but always present, because a portal without a
          name on it is a system, and Ankora is not selling a system. */}
      {(contact.managerName || waHref) && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-lineDark bg-white px-[18px] py-3.5">
          <span className="text-[12.5px] text-appNavy/60">
            {contact.managerName ? `מנהל התיק שלך: ${contact.managerName}` : "מנהל התיק שלך ב-Ankora"}
          </span>
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-lineDark px-3.5 py-1.5 text-xs text-appNavy hover:border-gold"
            >
              וואטסאפ
            </a>
          ) : (
            <span className="text-xs text-appNavy/35">וואטסאפ: זמין בקרוב</span>
          )}
        </div>
      )}

      {cycle && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-lineDark bg-white px-[18px] py-3.5">
          <span className="text-[12.5px] text-appNavy/60">
            מחזור השעות הנוכחי: {formatMinutes(cycle.usedMinutes)} מתוך {formatMinutes(cycle.totalMinutes)}
            {cycle.daysLeft !== null && ` · ${cycle.daysLeft} ימים לסיום`}
          </span>
          <Link href="/app/portal/hours" className="text-xs text-gold-dim hover:underline">
            פירוט השעות
          </Link>
        </div>
      )}
    </div>
  );
}
