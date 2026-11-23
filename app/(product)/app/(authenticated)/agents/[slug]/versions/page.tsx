import { getFormatter } from "next-intl/server";
import { Forbidden } from "@/components/app/Forbidden";
import { contentOf, draftProblems } from "@/lib/app-domain/agents";
import { diffBlocks, diffParams } from "@/lib/agents/diff";
import { AgentHeader, loadAgent } from "../shared";
import { DecideVersion, MarkFaulty, RevertToVersion } from "../../AgentForms";
import { ACTION_LEVEL_LABEL, BLOCK_KIND_LABEL, STATE_LABEL } from "../../labels";

// Agents, phase 1: "גרסאות". Every version, and one compared with the
// version before it in use, block by block, with the checks it must pass
// and, for a manager, the decision.

export const metadata = { robots: { index: false, follow: false } };

export default async function VersionsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> }) {
  const { slug } = await params;
  const { v } = await searchParams;
  const data = await loadAgent(slug);
  if (!data) return <Forbidden />;
  const format = await getFormatter();
  const when = (d: Date | null) => (d ? format.dateTime(d, { day: "numeric", month: "numeric" }) : "");
  const { agent, versions, approved, installations, canDecide } = data;
  const selected = versions.find((x) => String(x.version) === v) ?? data.draft ?? approved ?? versions[0];
  const base = selected ? versions.find((x) => x.state === "APPROVED" && x.version < selected.version) ?? null : null;
  const now = selected ? contentOf(selected) : null;
  const before = base ? contentOf(base) : null;
  const diff = now ? diffBlocks(before?.blocks ?? [], now.blocks) : null;
  const paramDiff = now ? diffParams(before?.params ?? [], now.params) : null;
  const problems = selected && (selected.state === "DRAFT" || selected.state === "PENDING") ? await draftProblems(selected) : [];
  const clientName = new Map(data.clients.map((c) => [c.id, c.name]));
  const affected = selected?.state === "PENDING" ? installations.filter((i) => (i.pinnedVersion ?? 0) < selected.version).length : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="versions" />
      <div className="flex flex-wrap items-start gap-5">
        <nav aria-label="גרסאות" className="flex min-w-0 flex-[0_1_280px] flex-col gap-1.5">
          {versions.map((x) => (
            <a
              key={x.id}
              href={`/app/agents/${agent.slug}/versions?v=${x.version}`}
              aria-current={selected?.id === x.id ? "page" : undefined}
              className={`rounded-xl border px-3.5 py-2.5 text-sm ${selected?.id === x.id ? "border-app-accent bg-white" : "border-app-border bg-white/60 hover:bg-white"}`}
            >
              <div className="font-medium">
                גרסה {x.version} <span className="text-xs font-normal text-app-text-secondary">{x.faultyAt ? "תקולה" : STATE_LABEL[x.state]}{x.id === approved?.id ? ", בשימוש" : ""}</span>
              </div>
              {x.changeNote && <div className="mt-0.5 line-clamp-2 text-xs text-app-text-secondary" dir="auto">{x.changeNote}</div>}
              <div className="mt-0.5 text-[11px] text-app-text-tertiary">
                {[x.createdByName, when(x.createdAt)].filter(Boolean).join(", ")}
                {x.state === "APPROVED" && x.decidedByName ? ` · אישר ${x.decidedByName}` : ""}
                {x.state === "REJECTED" && x.rejectReason ? ` · נדחתה: ${x.rejectReason}` : ""}
                {x.faultyAt && x.faultyReason ? ` · ${x.faultyReason}` : ""}
              </div>
            </a>
          ))}
        </nav>

        {selected && now && diff && (
          <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4">
            <section className="rounded-xl border border-app-border bg-white px-5 py-4">
              <h2 className="text-base font-medium">{base ? `גרסה ${base.version} מול גרסה ${selected.version}` : `גרסה ${selected.version}, הראשונה`}</h2>
              <p className="mt-1 text-[13px] text-app-text-secondary">
                {diff.changes.length} קטעים שונו, {diff.unchanged} לא השתנו · רמת פעולה: {ACTION_LEVEL_LABEL[now.actionLevel]}
                {before && before.actionLevel !== now.actionLevel ? ` (הייתה ${ACTION_LEVEL_LABEL[before.actionLevel]})` : ""}
              </p>
              {selected.changeNote && <p className="mt-2 text-sm" dir="auto">למה: {selected.changeNote}</p>}
              {paramDiff && (paramDiff.added.length + paramDiff.removed.length + paramDiff.changed.length > 0) && (
                <p className="mt-2 text-[13px] text-app-text-secondary">
                  פרמטרים: {[paramDiff.added.length ? `נוספו ${paramDiff.added.join(", ")}` : "", paramDiff.removed.length ? `הוסרו ${paramDiff.removed.join(", ")}` : "", paramDiff.changed.length ? `שונו ${paramDiff.changed.join(", ")}` : ""].filter(Boolean).join(" · ")}
                </p>
              )}
              {selected.state === "PENDING" && <p className="mt-2 rounded-lg bg-app-surface-page px-3 py-2 text-[13px]">מה זה ישנה בפועל: {affected} התקנות יקבלו את הגרסה בבדיקת העדכון הבאה. התקנה שהגרסה לא משנה לה דבר מתעדכנת בלי שאלה.</p>}
            </section>

            {diff.changes.map((c) => (
              <section key={c.key} className="rounded-xl border border-app-border bg-white px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium" dir="auto">
                    {c.clientId ? `תוספת ל${clientName.get(c.clientId) ?? "לקוח"}: ` : ""}{c.title}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "removed" ? "bg-app-error-soft text-app-error" : c.status === "added" ? "bg-app-success-soft text-app-success" : "bg-app-warning-soft text-app-warning"}`}>
                    {BLOCK_KIND_LABEL[c.kind]} · {c.status === "added" ? "נוסף" : c.status === "removed" ? "הוסר" : "שונה"}
                  </span>
                </div>
                <div className="mt-2 space-y-0.5 text-[13.5px] leading-relaxed" dir="auto">
                  {c.lines.map((l, i) => (
                    <div key={i} className={l.type === "add" ? "rounded bg-app-success-soft px-1" : l.type === "del" ? "rounded bg-app-error-soft px-1 line-through" : "px-1 text-app-text-secondary"}>
                      {l.type === "add" ? "+ " : l.type === "del" ? "- " : ""}
                      {l.text || " "}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {selected.state === "APPROVED" && !selected.faultyAt && canDecide && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-white px-5 py-3 text-[13px] text-app-text-secondary">
                <span>גרסה שגורמת נזק? סימון כתקולה מחזיר מיד את כל ההתקנות שעליה לגרסה הקודמת.</span>
                <MarkFaulty id={selected.id} version={selected.version} />
              </section>
            )}

            {selected.state === "APPROVED" && !selected.faultyAt && approved && selected.version < approved.version && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-white px-5 py-3 text-[13px] text-app-text-secondary">
                <span>{data.draft ? `גרסה ${data.draft.version} עוד פתוחה. כדי לחזור לגרסה הזו צריך קודם לסיים אותה: לשלוח או לבטל טיוטה, לאשר או לדחות גרסה שממתינה.` : "חזרה לגרסה הזו פותחת גרסה חדשה שהיא עותק שלה. היא נכנסת לשימוש רק אחרי אישור מנהל."}</span>
                {!data.draft && <RevertToVersion agentId={agent.id} slug={agent.slug} version={selected.version} />}
              </section>
            )}

            {(selected.state === "DRAFT" || selected.state === "PENDING") && (
              <section className="rounded-xl border border-app-border bg-white px-5 py-4">
                <h2 className="text-base font-medium">בדיקות לפני אישור</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {problems.length === 0 ? (
                    <li className="text-app-success">✓ אין מקף ארוך או בינוני, כל פרמטר בהוראות מוגדר, אין קטעים כפולים</li>
                  ) : (
                    problems.map((p) => <li key={p.code + p.text} className="text-app-error">! {p.text}</li>)
                  )}
                  {!selected.changeNote && <li className="text-app-error">! חסרה הערת שינוי: מה השתנה ולמה</li>}
                  {now.actionLevel === "SEND" && <li className="text-app-warning">! הסוכן שולח בשם אדם בלי אדם באמצע. כדאי לבדוק שיש מכסה וכללי שליחה ברורים</li>}
                </ul>
                {selected.state === "PENDING" && canDecide && (
                  <div className="mt-4">
                    <DecideVersion id={selected.id} version={selected.version} />
                  </div>
                )}
                {selected.state === "PENDING" && !canDecide && <p className="mt-3 text-[13px] text-app-text-secondary">ממתינה לאישור מנהל.</p>}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
