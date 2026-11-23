import { getFormatter, getTranslations } from "next-intl/server";
import { Forbidden } from "@/components/app/Forbidden";
import { canManageClients } from "@/lib/app-auth/permissions";
import { bootstrapText } from "@/lib/agents/compile";
import { CopyValue } from "@/components/app/CopyValue";
import { AgentHeader, loadAgent } from "../shared";
import { AcceptUpdate, NewInstallation, RemoveInstallation } from "../../AgentForms";

// Agents, phase 1: "התקנות". Who runs this agent, where, on which clients
// and version; a new installation ends with the bootstrap text.

export const metadata = { robots: { index: false, follow: false } };

const DEFAULT_SURFACE = { CLIENT_PROJECT: "PROJECT", SCHEDULED: "SCHEDULED", SKILL: "SKILL" } as const;

export default async function InstallationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadAgent(slug);
  if (!data) return <Forbidden />;
  const format = await getFormatter();
  const t = await getTranslations("agents.installations");
  const tl = await getTranslations("agents.labels");
  const when = (d: Date | null) => (d ? format.dateTime(d, { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : t("neverRan"));
  const { agent, installations, approved, content, clients, user } = data;
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const manager = canManageClients(user.role);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="installations" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-app-text-secondary">{t("intro")}</p>
        {approved ? (
          <NewInstallation agentId={agent.id} clients={clients} installParams={content.params.filter((p) => p.level === "INSTALLATION")} defaultSurface={DEFAULT_SURFACE[agent.kind]} />
        ) : (
          <span className="text-[13px] text-app-text-tertiary">{t("afterApproval")}</span>
        )}
      </div>

      {installations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-app-border bg-white p-6 text-center text-sm text-app-text-secondary">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-app-border bg-white">
          <table className="w-full min-w-[900px] text-[13.5px]">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-secondary">
                <th className="px-4 py-2.5 text-start font-normal">{t("col.who")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.where")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.clients")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.version")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.check")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.fetched")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.lastRun")}</th>
                <th className="px-4 py-2.5 text-start font-normal">{t("col.state")}</th>
              </tr>
            </thead>
            <tbody>
              {installations.map((i) => {
                const mine = i.userId === user.id;
                const behind = approved && (i.pinnedVersion ?? 0) < approved.version;
                return (
                  <tr key={i.id} id={`installation-${i.id}`} className="border-b border-app-border align-top last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {i.userName}
                      {i.claudeAccount && <div className="text-xs font-normal text-app-text-tertiary" dir="ltr">{i.claudeAccount}</div>}
                    </td>
                    <td className="px-4 py-3">{tl(`surface.${i.surface}`)}</td>
                    <td className="px-4 py-3">{i.clientScope === "ALL_MINE" ? t("allClients") : i.clientIds.map((id) => clientName.get(id) ?? t("client")).join(", ")}</td>
                    <td className="px-4 py-3">{i.pinnedVersion ?? ""}</td>
                    <td className="px-4 py-3">{tl(`check.${i.checkEvery}`)}</td>
                    <td className="px-4 py-3">{when(i.lastFetchedAt)}</td>
                    <td className="max-w-[260px] px-4 py-3">
                      {i.runs[0] ? (
                        <>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${i.runs[0].outcome === "OK" ? "bg-app-success-soft text-app-success" : i.runs[0].outcome === "FAILED" ? "bg-app-error-soft text-app-error" : "bg-app-warning-soft text-app-warning"}`}>{t("runAt", { outcome: tl(`run.${i.runs[0].outcome}`), when: when(i.runs[0].createdAt) })}</span>
                          <div className="mt-1 text-xs text-app-text-secondary" dir="auto">{i.runs[0].summary}</div>
                          {[...i.runs[0].missing.map((m) => t("missing", { item: m })), ...i.runs[0].problems].slice(0, 3).map((p, k) => (
                            <div key={k} className="text-xs text-app-error" dir="auto">{p}</div>
                          ))}
                        </>
                      ) : (
                        <span className="text-xs text-app-text-tertiary">{t("notReported")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-2">
                        {behind ? <span className="rounded-full bg-app-warning-soft px-2 py-0.5 text-xs text-app-warning">{t("updateWaiting", { version: approved!.version })}</span> : i.lastFetchedAt ? <span className="rounded-full bg-app-success-soft px-2 py-0.5 text-xs text-app-success">{t("upToDate")}</span> : <span className="rounded-full bg-app-neutral-soft px-2 py-0.5 text-xs text-app-text-secondary">{t("waitingFirst")}</span>}
                        <div className="flex flex-wrap gap-2">
                          {behind && (mine || manager) && <AcceptUpdate id={i.id} version={approved!.version} />}
                          {(mine || manager) && <RemoveInstallation id={i.id} />}
                        </div>
                        {mine && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-app-text-accent">{t("bootstrap")}</summary>
                            <pre dir="auto" className="mt-1.5 max-w-md whitespace-pre-wrap rounded-lg bg-app-surface-page p-2 text-[12px]">{bootstrapText(agent, i.id, user.locale)}</pre>
                            <CopyValue value={bootstrapText(agent, i.id, user.locale)} label={t("bootstrap")} />
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
