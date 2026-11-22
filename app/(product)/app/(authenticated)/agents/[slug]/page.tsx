import { Forbidden } from "@/components/app/Forbidden";
import { AgentHeader, loadAgent } from "./shared";
import { ACTION_LEVEL_LABEL, SURFACE_LABEL } from "../labels";
import type { AgentBlock } from "@/lib/agents/model";

// Agents, phase 1: "סקירה". How the agent works, built from its blocks:
// when it runs, what it reads, what it does, what comes out, and beside it
// what it never does and what needs a person. Each guardrail names the
// block it comes from, so a rule can be traced back to its text.

export const metadata = { robots: { index: false, follow: false } };

const lines = (blocks: AgentBlock[]) => blocks.flatMap((b) => b.body.split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim()).filter(Boolean));

function Column({ title, items, numbered }: { title: string; items: string[]; numbered?: boolean }) {
  return (
    <div className="min-w-0 flex-1 basis-48 rounded-xl border border-app-border bg-app-surface-page p-3.5">
      <h3 className="text-xs font-medium text-app-text-secondary">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-app-text-tertiary">לא כתוב בהוראות</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed" dir="auto">
          {items.slice(0, 8).map((t, i) => (
            <li key={i}>{numbered ? `${i + 1}. ` : ""}{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function AgentOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadAgent(slug);
  if (!data) return <Forbidden />;
  const { approved, installations, content } = data;
  // The version being edited: the draft when there is one, else the one in use.
  const shown = content;
  const of = (...kinds: AgentBlock["kind"][]) => shown.blocks.filter((b) => !b.clientId && kinds.includes(b.kind));
  const never = shown.blocks.filter((b) => !b.clientId && (b.safety || b.kind === "rules"));
  const needsPerson = of("approvals");
  const req = shown.requirements;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="overview" />
      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[2_1_560px] rounded-xl border border-app-border bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium">איך הוא עובד</h2>
            <span className="text-xs text-app-text-tertiary">נבנה מקטעי ההוראות{data.editing ? ` של גרסה ${data.editing.version}` : ""} · {ACTION_LEVEL_LABEL[shown.actionLevel]}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Column title="מתי" items={lines(of("schedule"))} />
            <Column title="מה הוא קורא" items={lines(of("scope", "live"))} />
            <Column title="מה הוא עושה" items={lines(of("steps"))} numbered />
            <Column title="מה יוצא" items={lines(of("output"))} />
          </div>
          {(req.connectors.length > 0 || req.skills.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-app-text-secondary">
              <span>כלים וחיבורים:</span>
              {[...req.connectors, ...req.skills].map((c) => (
                <span key={c} className="rounded-full border border-app-border bg-white px-2 py-0.5" dir="ltr">{c}</span>
              ))}
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          <section className="rounded-xl border border-app-error/30 bg-white p-4">
            <h2 className="text-sm font-medium">לעולם לא</h2>
            {never.length === 0 ? <p className="mt-1 text-[13px] text-app-text-tertiary">לא כתובים כללים ואיסורים.</p> : (
              <ul className="mt-1.5 space-y-1 text-[13px]" dir="auto">
                {never.map((b) => (
                  <li key={b.key}>
                    {lines([b]).slice(0, 4).map((l, i) => <div key={i}>✕ {l}</div>)}
                    <div className="text-[11px] text-app-text-tertiary">מתוך: {b.title}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-app-border bg-white p-4">
            <h2 className="text-sm font-medium">רק באישור של אדם</h2>
            {needsPerson.length === 0 ? <p className="mt-1 text-[13px] text-app-text-tertiary">לא כתוב.</p> : (
              <ul className="mt-1.5 space-y-1 text-[13px]" dir="auto">
                {lines(needsPerson).slice(0, 6).map((l, i) => <li key={i}>{l}</li>)}
                <li className="text-[11px] text-app-text-tertiary">מתוך: {needsPerson.map((b) => b.title).join(", ")}</li>
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-app-border bg-white p-4">
            <h2 className="text-sm font-medium">רץ אצל</h2>
            {installations.length === 0 ? <p className="mt-1 text-[13px] text-app-text-tertiary">אין התקנות.</p> : (
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {installations.map((i) => (
                  <li key={i.id}>
                    {i.userName}, {SURFACE_LABEL[i.surface]}, גרסה {i.pinnedVersion}
                    {approved && (i.pinnedVersion ?? 0) < approved.version ? <span className="text-app-warning">, עדכון ממתין</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <a href={`/app/agents/${data.agent.slug}/installations`} className="mt-2 inline-block text-xs text-app-text-accent">לכל ההתקנות</a>
          </section>
        </div>
      </div>
    </div>
  );
}
