import { getLocale, getTranslations } from "next-intl/server";
import type { RunBrief as Brief } from "@/lib/process-runs";

// What a run's task says about its procedure (14.11.2026), in the reader's
// language. Opened runs keep it as data (Task.runBrief); runs opened
// before keep their Hebrew description instead and show nothing here.
// What the client's file says (purpose, rules, the steps' words) is shown
// as written.

export async function RunBrief({ brief }: { brief: Brief }) {
  const t = await getTranslations("tasks.detail.runBrief");
  const tl = await getTranslations("clients.processes.labels");
  const locale = await getLocale();
  const day = (key: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const gaps = [
    ...brief.gaps.missing.map((k) => t("missing", { field: tl(`fields.${k}` as never) })),
    ...(brief.gaps.noAccess.length ? [t("noAccess", { systems: brief.gaps.noAccess.join(", ") })] : []),
  ];
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-app-border bg-app-surface-card px-[18px] py-4 text-[14px] text-app-text-primary" data-testid="run-brief">
      <h2 className="text-[15px] font-bold">{t("title", { code: brief.code, version: brief.version })}</h2>
      {brief.review && <p className="rounded-xl bg-app-warning-soft px-3 py-2 text-app-warning">{t("review", { reason: tl(`reviewReasons.${brief.review}` as never) })}</p>}
      {brief.purpose && (
        <p>
          <span className="text-app-text-secondary">{t("why")} </span>
          <span dir="auto">{brief.purpose}</span>
        </p>
      )}
      {brief.doNotDisclose && (
        <p>
          <span className="font-bold">{t("doNotDisclose")} </span>
          <span dir="auto">{brief.doNotDisclose}</span>
        </p>
      )}
      <div>
        <p className="font-bold">{t("steps")}</p>
        <ol className="mt-1 flex list-decimal flex-col gap-1 ps-5">
          {brief.steps.map((s, i) => {
            const details = [
              tl(`stepModes.${s.mode}` as never),
              s.actionTags.length ? s.actionTags.map((a) => tl(`actionTags.${a}` as never)).join(", ") : null,
              s.systems.length ? s.systems.join(", ") : null,
              s.output ? t("output", { output: s.output }) : null,
              s.verification ? t("verification", { verification: s.verification }) : null,
              s.approver ? t("approver", { name: s.approver }) : null,
            ].filter(Boolean);
            return (
              <li key={i}>
                <span dir="auto">{s.title}</span> <span className="text-app-text-secondary">({details.join(" · ")})</span>
              </li>
            );
          })}
        </ol>
      </div>
      {brief.highlights && (
        <p>
          <span className="font-bold">{t("highlights")} </span>
          <span dir="auto">{brief.highlights}</span>
        </p>
      )}
      {brief.outputs && (
        <p>
          <span className="font-bold">{t("doneWhen")} </span>
          <span dir="auto">{brief.outputs}</span>
        </p>
      )}
      {brief.rules.length > 0 && (
        <div>
          <p className="font-bold">{t("rules")}</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
            {brief.rules.map((r, i) => (
              <li key={i} dir="auto">
                {r.title}: {r.startsOn ? `${t("from", { date: day(r.startsOn) })} ` : ""}
                {r.text}
                {r.proposedRule ? ` ${t("interim", { rule: r.proposedRule })}` : r.proposed ? ` ${t("proposed")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief.exceptions.length > 0 && (
        <div>
          <p className="font-bold">{t("exceptions")}</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
            {brief.exceptions.map((e, i) => (
              <li key={i} dir="auto">
                {e.policy}: {e.what}, {t("until", { date: day(e.until) })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {gaps.length > 0 && (
        <div>
          <p className="font-bold">{t("gaps")}</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {brief.exceptionPlaybook && (
        <p>
          <span className="font-bold">{t("playbook")} </span>
          <span dir="auto">{brief.exceptionPlaybook}</span>
        </p>
      )}
    </section>
  );
}
