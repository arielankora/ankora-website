import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalDecisions } from "@/lib/app-domain/decisions";
import { resolvePortalClient } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { formatMinor } from "@/lib/money";
import { whatsappHref } from "@/lib/whatsapp";
import { PortalTabs } from "../PortalTabs";
import { DecisionCard } from "./DecisionCard";

export const metadata = { robots: { index: false, follow: false } };

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

// Portal phase 2. The screen the portal exists for.
//
// Reading is what a client does here most of the time; answering is the
// rare, valuable moment. So the open decisions are the whole top of the
// screen, and the record of what was already decided sits below them -
// quiet, but present, because "what did I approve, and when" is a
// question people ask months later.
export default async function PortalDecisionsPage() {
  const user = await requireUser();

  let decisions;
  let ctx;
  try {
    [decisions, ctx] = await Promise.all([getPortalDecisions(user), resolvePortalClient(user)]);
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden />;
    throw err;
  }

  const canAnswer = ctx.clientUserRole === "ADMIN" && !ctx.isStaffPreview;
  const waHref = whatsappHref(ctx.client.whatsappNumber);

  return (
    <div className="space-y-4">
      <PortalTabs active="decisions" />

      {decisions.open.length === 0 ? (
        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <p className="text-[13.5px] font-medium text-appNavy">אין כרגע החלטות שמחכות לך</p>
          <p className="mt-1.5 text-[13px] text-appNavy/60">
            כשנגיע לצומת שדורשת הכרעה שלך, היא תופיע כאן עם האפשרויות, המחירים וההמלצה שלנו.
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
                dueAt: d.dueAt?.toISOString() ?? null,
                taskTitle: d.taskTitle,
                options: d.options,
              }}
            />
          ))}
        </div>
      )}

      {decisions.closed.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
          <div className="border-b border-lineDark px-[18px] py-3.5 text-[13.5px] font-medium text-appNavy">
            החלטות קודמות
          </div>
          <div className="divide-y divide-lineDark/60">
            {decisions.closed.map((d) => (
              <div key={d.id} className="px-[18px] py-3.5">
                <p className="text-sm text-appNavy">{d.question}</p>
                {d.answer ? (
                  <p className="mt-1 text-[12px] text-appNavy/60">
                    נבחר: {d.answer.optionLabel}
                    {formatMinor(d.answer.amountMinor) ? ` · ${formatMinor(d.answer.amountMinor)}` : ""} · אושר על ידי{" "}
                    {d.answer.respondedByName} ב-{formatDate(d.answer.respondedAt)}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-appNavy/50">בוטל על ידי Ankora. לא נדרשה ממך החלטה.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
