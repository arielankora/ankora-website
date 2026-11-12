import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalHome } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { whatsappHref } from "@/lib/whatsapp";
import { PromiseList } from "./PromiseList";
import { portalHeadlineKey } from "@/lib/app-domain/portal-labels";
import { bankFigures, packageFigures } from "@/lib/hours-format";

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

  const { client, waitingOnClient, inProgress, recentlyDone, cycle, openDecisions, contact } = home;
  const nothingYet =
    openDecisions === 0 && waitingOnClient.length === 0 && inProgress.length === 0 && recentlyDone.length === 0;
  const waHref = whatsappHref(contact.whatsappNumber);
  const t = await getTranslations("portal.home");
  const format = await getFormatter();
  const headline = portalHeadlineKey(openDecisions, waitingOnClient.length, inProgress.length);
  const figure = (chunks: React.ReactNode) => <bdi dir="ltr">{chunks}</bdi>;

  return (
    <div className="space-y-4">
      {/* 20.10.2026 (canvas, portal boards): one action at the top. When a
          decision waits, the headline says so and one gold button leads
          there; otherwise the headline is the whole message. */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-app-border bg-white p-6 sm:p-7">
        <div>
          <p className="text-[13.5px] text-app-text-secondary">{t("greeting", { name: client.name })}</p>
          <p className="mt-1.5 text-xl font-medium text-app-text-primary">
            {t(`headline.${headline.kind}`, { count: headline.count })}
          </p>
        </div>
        {openDecisions > 0 && (
          <Link
            href="/app/portal/decisions"
            data-testid="portal-home-decisions"
            className="rounded-full bg-app-accent px-5 py-3 text-sm font-medium text-app-text-primary hover:opacity-90"
          >
            {t("viewDecisions", { count: openDecisions })}
          </Link>
        )}
      </div>

      {nothingYet ? (
        // The empty state of a brand-new client, and the one place the
        // portal explains itself. Written as a promise with a date on it
        // rather than as a tour: "here is what will appear, and when".
        <div className="rounded-2xl border border-app-border bg-white p-6">
          <p className="text-[13.5px] font-medium text-app-text-primary">{t("empty.title")}</p>
          <ul className="mt-3 space-y-2 text-sm text-app-text-secondary">
            <li>{t("empty.received")}</li>
            <li>{t("empty.waiting")}</li>
            <li>{t("empty.done")}</li>
          </ul>
          <p className="mt-4 text-[12.5px] text-app-text-tertiary">
            {t("empty.firstItem")}
          </p>
        </div>
      ) : (
        <>

          {/* "מחכה לך", not "מחכה להחלטה שלך".
              These are promises in flight that need something from the
              client - an answer, a document, a key. They are not
              decisions, and the decisions tab does not list them. Calling
              them decisions sent a client to that tab to be told nothing
              was waiting, which is the fastest way to teach someone the
              portal is not accurate. The wording here is the same stage
              label they read on every other screen. */}
          {waitingOnClient.length > 0 && (
            <PromiseList title={t("waitingTitle")} promises={waitingOnClient} tone="attention" showStage={false} />
          )}

          <PromiseList
            title={t("inProgressTitle")}
            promises={inProgress}
            emptyText={t("inProgressEmpty")}
          />

          <PromiseList
            title={t("recentlyDoneTitle")}
            promises={recentlyDone}
            action={
              <Link href="/app/portal/activity" className="text-xs text-app-text-accent hover:underline">
                {t("allActivity")}
              </Link>
            }
            showStage={false}
          />
        </>
      )}

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
              {contact.managerName ? t("managerNamed", { name: contact.managerName }) : t("managerUnnamed")}
            </span>
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-app-border-strong px-3.5 py-1.5 text-xs text-app-text-primary hover:border-app-accent"
              >
                {t("whatsapp")}
              </a>
            ) : (
              <span className="text-xs text-app-text-tertiary">{t("whatsappSoon")}</span>
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
                  {t.rich("package", {
                    consumed: packageFigures(cycle.purchasedMinutes, cycle.remainingMinutes).consumed,
                    total: packageFigures(cycle.purchasedMinutes, cycle.remainingMinutes).total,
                    n: figure,
                  })}
                  {cycle.forecast?.status === "projected" &&
                    ` · ${t("packageLasts", {
                      date: format.dateTime(cycle.forecast.depletionDate, { dateStyle: "medium", timeZone: client.timezone }),
                    })}`}
                  {cycle.forecast?.status === "depleted" && ` · ${t("packageUsedUp")}`}
                </>
              ) : (
                <>
                  {t.rich("cycle", {
                    consumed: bankFigures(cycle.totalMinutes, cycle.usedMinutes).consumed,
                    total: bankFigures(cycle.totalMinutes, cycle.usedMinutes).total,
                    n: figure,
                  })}
                </>
              )}
              {cycle.daysLeft !== null && ` · ${t("daysLeft", { days: String(cycle.daysLeft) })}`}
            </span>
            <Link href="/app/portal/hours" className="text-xs text-app-text-accent hover:underline">
              {t("hoursDetail")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
