import { getTranslations } from "next-intl/server";
import { Forbidden } from "@/components/app/Forbidden";
import { AgentHeader, loadAgent } from "./shared";
import { listLessons } from "@/lib/app-domain/agent-library";
import { linkableProcesses } from "@/lib/app-domain/agents";
import { listAgentCategories } from "@/lib/app-domain/agent-categories";
import { LessonButtons, LinkProcess, PickCategories } from "../AgentForms";
import { skillOf, type AgentBlock } from "@/lib/agents/model";

// Agents, phase 1: "סקירה". How the agent works, built from its blocks:
// when it runs, what it reads, what it does, what comes out, and beside it
// what it never does and what needs a person. Each guardrail names the
// block it comes from, so a rule can be traced back to its text.

export const metadata = { robots: { index: false, follow: false } };

const lines = (blocks: AgentBlock[]) => blocks.flatMap((b) => b.body.split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim()).filter(Boolean));

function Column({ title, items, numbered, empty }: { title: string; items: string[]; numbered?: boolean; empty: string }) {
  return (
    <div className="min-w-0 flex-1 basis-48 rounded-xl border border-app-border bg-app-surface-page p-3.5">
      <h3 className="text-xs font-medium text-app-text-secondary">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] text-app-text-tertiary">{empty}</p>
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
  const lessons = await listLessons(data.user, data.agent.id);
  const processOptions = data.canDecide ? await linkableProcesses(data.user) : [];
  const categoryOptions = data.canDecide ? (await listAgentCategories(data.user)).map((c) => ({ id: c.id, name: c.name })) : [];
  const t = await getTranslations("agents.overview");
  const tl = await getTranslations("agents.labels");
  const notWritten = t("notWritten");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="overview" />
      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[2_1_560px] rounded-xl border border-app-border bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium">{t("howItWorks")}</h2>
            <span className="text-xs text-app-text-tertiary">{data.editing ? t("builtFromVersion", { version: data.editing.version }) : t("builtFrom")} · {tl(`actionLevel.${shown.actionLevel}`)}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Column title={t("when")} items={lines(of("schedule"))} empty={notWritten} />
            <Column title={t("reads")} items={lines(of("scope", "live"))} empty={notWritten} />
            <Column title={t("does")} items={lines(of("steps"))} numbered empty={notWritten} />
            <Column title={t("outputs")} items={lines(of("output"))} empty={notWritten} />
          </div>
          {(req.connectors.length > 0 || req.skills.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-app-text-secondary">
              <span>{t("tools")}</span>
              {[...req.connectors, ...req.skills.map((s) => { const { slug, minVersion } = skillOf(s); return minVersion ? t("skillMin", { slug, version: minVersion }) : slug; })].map((c) => (
                <span key={c} className="rounded-full border border-app-border bg-white px-2 py-0.5" dir="ltr">{c}</span>
              ))}
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          <section className="rounded-xl border border-app-error/30 bg-white p-4">
            <h2 className="text-sm font-medium">{t("never")}</h2>
            {never.length === 0 ? <p className="mt-1 text-[13px] text-app-text-tertiary">{t("neverEmpty")}</p> : (
              <ul className="mt-1.5 space-y-1 text-[13px]" dir="auto">
                {never.map((b) => (
                  <li key={b.key}>
                    {lines([b]).slice(0, 4).map((l, i) => <div key={i}>✕ {l}</div>)}
                    <div className="text-[11px] text-app-text-tertiary">{t("from", { title: b.title })}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-app-border bg-white p-4">
            <h2 className="text-sm font-medium">{t("needsPerson")}</h2>
            {needsPerson.length === 0 ? <p className="mt-1 text-[13px] text-app-text-tertiary">{t("needsPersonEmpty")}</p> : (
              <ul className="mt-1.5 space-y-1 text-[13px]" dir="auto">
                {lines(needsPerson).slice(0, 6).map((l, i) => <li key={i}>{l}</li>)}
                <li className="text-[11px] text-app-text-tertiary">{t("from", { title: needsPerson.map((b) => b.title).join(", ") })}</li>
              </ul>
            )}
          </section>
          {lessons.length > 0 && (
            <section className="rounded-xl border border-app-accent bg-app-accent-soft p-4">
              <h2 className="text-sm font-medium">{t("lessons", { count: lessons.length })}</h2>
              <ul className="mt-2 space-y-3 text-[13px]">
                {lessons.map((l) => (
                  <li key={l.id}>
                    <p dir="auto">{l.text}</p>
                    {l.blockKey && <p className="text-[11px] text-app-text-tertiary">{t("onBlock", { title: shown.blocks.find((b) => b.key === l.blockKey)?.title ?? l.blockKey })}</p>}
                    <div className="mt-1.5"><LessonButtons id={l.id} /></div>
                  </li>
                ))}
              </ul>
              <a href={`/app/agents/${data.agent.slug}/instructions`} className="mt-2 inline-block text-xs text-app-text-accent">{t("editInDraft")}</a>
            </section>
          )}
          <section className="rounded-xl border border-app-border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t("categories")}</h2>
              {data.canDecide && <PickCategories agentId={data.agent.id} current={data.categories.map((c) => c.id)} options={categoryOptions} />}
            </div>
            {data.categories.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {data.categories.map((c) => (
                  <span key={c.id} className="rounded-full border border-app-border bg-app-surface-page px-2 py-0.5 text-xs text-app-text-secondary" dir="auto">{c.name}</span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-app-text-tertiary">{t("noCategories")}</p>
            )}
          </section>
          <section className="rounded-xl border border-app-border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t("process")}</h2>
              {data.canDecide && <LinkProcess agentId={data.agent.id} current={data.process?.id ?? null} options={processOptions} />}
            </div>
            {data.process ? (
              <p className="mt-1 text-[13px]" dir="auto">
                {data.process.clientName} · {data.process.code} {data.process.title}
                <span className="block text-[11px] text-app-text-tertiary">{t("processSteps")}</span>
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-app-text-tertiary">{t("noProcess")}</p>
            )}
          </section>
          <section className="rounded-xl border border-app-border bg-white p-4">
            <h2 className="text-sm font-medium">{t("runsAt")}</h2>
            {installations.length === 0 ? <p className="mt-1 text-[13px] text-app-text-tertiary">{t("noInstalls")}</p> : (
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {installations.map((i) => (
                  <li key={i.id}>
                    {t("install", { user: i.userName, surface: tl(`surface.${i.surface}`), version: i.pinnedVersion ?? "" })}
                    {approved && (i.pinnedVersion ?? 0) < approved.version ? <span className="text-app-warning">{t("updateWaiting")}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <a href={`/app/agents/${data.agent.slug}/installations`} className="mt-2 inline-block text-xs text-app-text-accent">{t("allInstalls")}</a>
          </section>
        </div>
      </div>
    </div>
  );
}
