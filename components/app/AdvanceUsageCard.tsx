import type { AdvanceUsage } from "@/lib/app-domain/task-plans";

// "קדם עם קלוד" (10.10.2026): is the flow used, and does it finish?
//
// On the integrations screen, under the Claude connection, because that is
// the connection the flow runs through. Three counts in the order the flow
// happens: a prompt copied, a plan saved back, a plan turned into steps.
// The drop between them is the reading: many copies and few plans means
// conversations that are started and abandoned.

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-lineDark/70 px-4 py-3">
      <p className="text-[12px] text-appNavy/55">{label}</p>
      <p className="mt-1 font-jbmono text-xl text-appNavy">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-appNavy/45">{hint}</p>}
    </div>
  );
}

export function AdvanceUsageCard({ usage }: { usage: AdvanceUsage }) {
  const copies = usage.copiesPlan + usage.copiesLessons;
  const plans = usage.plansViaClaude + usage.plansInApp;

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6" data-testid="advance-usage">
      <h2 className="text-base font-medium text-appNavy">קדם עם קלוד</h2>
      <p className="mt-1 text-sm text-appNavy/60">שימוש ב-{usage.days} הימים האחרונים, בכל הלקוחות.</p>

      {copies === 0 && plans === 0 ? (
        <p className="mt-4 text-sm text-appNavy/55">עדיין אין שימוש בתקופה הזו.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat
              label="פרומטים שהועתקו"
              value={copies}
              hint={usage.copiesLessons > 0 ? `מתוכם ${usage.copiesLessons} לסיכום ולקחים` : undefined}
            />
            <Stat
              label="תוכניות שנשמרו"
              value={plans}
              hint={`${usage.plansViaClaude} דרך קלוד, ${usage.plansInApp} במערכת · ${usage.tasksWithPlan} משימות`}
            />
            <Stat label="תוכניות שהפכו לשלבים" value={usage.plansApplied} />
          </div>

          {usage.people.length > 0 && (
            <table className="mt-5 w-full text-start text-[13px]">
              <thead>
                <tr className="text-[12px] text-appNavy/50">
                  <th className="pb-2 text-start font-normal">מי</th>
                  <th className="pb-2 text-start font-normal">פרומטים</th>
                  <th className="pb-2 text-start font-normal">גרסאות תוכנית</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lineDark/60">
                {usage.people.map((p) => (
                  <tr key={p.name}>
                    <td className="py-2 text-appNavy">{p.name}</td>
                    <td className="py-2 font-jbmono text-appNavy/75">{p.copies}</td>
                    <td className="py-2 font-jbmono text-appNavy/75">{p.plans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
