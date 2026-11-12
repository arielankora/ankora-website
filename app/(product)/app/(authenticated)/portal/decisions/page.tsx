import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { TIMEZONE } from "@/lib/timezone";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalDecisions } from "@/lib/app-domain/decisions";
import { resolvePortalClient } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { formatMinor } from "@/lib/money";
import { whatsappHref } from "@/lib/whatsapp";
import { DecisionCard } from "./DecisionCard";

export const metadata = { robots: { index: false, follow: false } };

// Portal phase 2. The screen the portal exists for.
//
// Reading is what a client does here most of the time; answering is the
// rare, valuable moment. So the open decisions are the whole top of the
// screen, and the record of what was already decided sits below them -
// quiet, but present, because "what did I approve, and when" is a
// question people ask months later.
export default async function PortalDecisionsPage(props: {
  searchParams: Promise<{ answered?: string }>;
}) {
  const { answered } = await props.searchParams;
  const user = await requireUser();

  let decisions;
  let ctx;
  try {
    [decisions, ctx] = await Promise.all([getPortalDecisions(user), resolvePortalClient(user)]);
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden />;
    throw err;
  }

  const t = await getTranslations("portal.decisions");
  const tCard = await getTranslations("portal.decisionCard");
  const format = await getFormatter();
  const locale = await getLocale();
  // ADR 0006: in the reader's language. When an answer was given is an
  // instant, in the reader's own time zone; a due date is an Israeli day.
  const formatDate = (date: Date) => format.dateTime(date, { dateStyle: "medium" });
  const money = (minor: number | null) => formatMinor(minor, locale);

  const canAnswer = ctx.clientUserRole === "ADMIN" && !ctx.isStaffPreview;
  const waHref = whatsappHref(ctx.client.whatsappNumber);

  // The confirmation, rendered from the server rather than held in the
  // card's own state - so it is still on the screen after the redraw that
  // replaces the card with the record. Matched against the closed list so
  // a hand-edited id says nothing.
  const justAnswered = answered ? decisions.closed.find((d) => d.id === answered) : undefined;

  return (
    <div className="space-y-4">

      {justAnswered && (
        <div className="rounded-2xl border border-app-success/25 bg-app-success-soft px-[18px] py-3.5">
          <p className="text-[13.5px] text-app-success">{t("answered")}</p>
          {justAnswered.answer && (
            <p className="mt-1 text-[12.5px] text-app-text-secondary">{t("chosen", { option: justAnswered.answer.optionLabel })}</p>
          )}
        </div>
      )}

      {decisions.open.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-white p-6">
          <p className="text-[13.5px] font-medium text-app-text-primary">{t("noneTitle")}</p>
          <p className="mt-1.5 text-[13px] text-app-text-secondary">
            {t("noneBody")}
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {decisions.open.map((d) => (
            <DecisionCard
              key={d.id}
              canAnswer={canAnswer}
              whatsappHref={waHref}
              decision={{
                id: d.id,
                question: d.question,
                background: d.background,
                amountMinor: d.amountMinor,
                ceilingMinor: d.ceilingMinor,
                aboveCeiling: d.aboveCeiling,
                dueLabel: d.dueAt
                  ? tCard("dueBy", { date: format.dateTime(d.dueAt, { day: "numeric", month: "long", timeZone: TIMEZONE }) })
                  : null,
                taskTitle: d.taskTitle,
                options: d.options,
              }}
            />
          ))}
        </div>
      )}

      {decisions.closed.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-app-border bg-white">
          <div className="border-b border-app-border px-[18px] py-3.5 text-[13.5px] font-medium text-app-text-primary">
            {t("previous")}
          </div>
          <div className="divide-y divide-app-border">
            {decisions.closed.map((d) => (
              <div key={d.id} className="px-[18px] py-3.5">
                <p dir="auto" className="text-page-start text-sm text-app-text-primary">
                  {d.question}
                </p>
                {d.answer ? (
                  <p className="mt-1 text-[12px] text-app-text-secondary">
                    {money(d.answer.amountMinor)
                      ? t("recordWithAmount", {
                          option: d.answer.optionLabel,
                          amount: money(d.answer.amountMinor) ?? "",
                          name: d.answer.respondedByName,
                          date: formatDate(d.answer.respondedAt),
                        })
                      : t("record", {
                          option: d.answer.optionLabel,
                          name: d.answer.respondedByName,
                          date: formatDate(d.answer.respondedAt),
                        })}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-app-text-tertiary">{t("cancelled")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
