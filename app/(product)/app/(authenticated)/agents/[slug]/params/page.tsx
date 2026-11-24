import { getTranslations } from "next-intl/server";
import { Forbidden } from "@/components/app/Forbidden";
import { AgentHeader, loadAgent } from "../shared";
import { clientEmailContacts } from "@/lib/app-domain/agents";
import { DeleteParam, EditClientValue, EditParam } from "../../AgentForms";

// Agents, phase 1: "פרמטרים". What each parameter is, its value per client
// (typed for this agent, or taken from the client's file), and the
// installation-level values of each person running it.

export const metadata = { robots: { index: false, follow: false } };

export default async function ParamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadAgent(slug);
  if (!data) return <Forbidden />;
  const { agent, content, clients, installations } = data;
  const canEdit = !data.draft || data.draft.state === "DRAFT";
  const clientParams = content.params.filter((p) => p.level === "CLIENT");
  const installParams = content.params.filter((p) => p.level === "INSTALLATION");
  const resolved = await data.resolve(clients.map((c) => c.id));
  const t = await getTranslations("agents.params");
  const tl = await getTranslations("agents.labels");
  const typed = new Map(data.clientValues.map((v) => [`${v.clientId}:${v.key}`, v.value]));
  // What a value looks like: the parameter's own example, else its type's.
  const exampleOf = (p: (typeof content.params)[number]) => p.example || tl(`paramFormat.${p.type}`);
  const contacts = clientParams.some((p) => p.type === "EMAIL" && !p.clientField) ? await clientEmailContacts(data.user, resolved.map((c) => c.id)) : new Map<string, { name: string; email: string }[]>();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="params" />

      <p className="text-[13px] text-app-text-secondary">{t("intro")}</p>

      <section className="rounded-xl border border-app-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border px-5 py-3">
          <h2 className="text-base font-medium">{t("title")}</h2>
          {canEdit && <EditParam agentId={agent.id} />}
        </div>
        {content.params.length === 0 ? (
          <p className="px-5 py-4 text-sm text-app-text-secondary">{t("empty", { example: `{{${t("exampleKey")}}}` })}</p>
        ) : (
          <ul className="divide-y divide-app-border">
            {content.params.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <span className="font-medium" dir="auto">{p.label}</span> <span className="text-xs text-app-text-tertiary" dir="auto">{`{{${p.key}}}`}</span>
                  <div className="text-xs text-app-text-secondary">
                    {tl(`paramLevel.${p.level}`)} · {tl(`paramType.${p.type}`)}
                    {p.required ? t("required") : ""}
                    {p.clientField ? t("fromFile") : ""}
                    {p.default ? t("default", { value: p.default }) : ""}
                    {p.example ? t("example", { value: p.example }) : ""}
                  </div>
                </div>
                {canEdit && (
                  <span className="flex items-center gap-2">
                    <EditParam agentId={agent.id} param={p} />
                    <DeleteParam agentId={agent.id} paramKey={p.key} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {clientParams.length > 0 && (
        <section className="rounded-xl border border-app-border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border px-5 py-3">
            <h2 className="text-base font-medium">{t("perClient")}</h2>
            <div className="flex flex-wrap gap-3 text-xs text-app-text-secondary">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-app-border-strong" />{t("legendDefault")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-app-info" />{t("legendFile")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-app-accent" />{t("legendAgent")}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13.5px]">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="px-4 py-2.5 text-start font-normal">{t("client")}</th>
                  {clientParams.map((p) => (
                    <th key={p.key} className="px-4 py-2.5 text-start font-normal">{p.label}{p.required ? " *" : ""}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resolved.map((c) => (
                  <tr key={c.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    {clientParams.map((p) => {
                      const own = typed.get(`${c.id}:${p.key}`);
                      const fromFile = !!p.clientField;
                      const value = c.values[p.key];
                      const edge = fromFile ? "border-app-info" : own ? "border-app-accent" : "border-transparent";
                      return (
                        <td key={p.key} className={`border-s-[3px] px-4 py-3 align-top ${edge}`}>
                          {value ? <span dir="auto">{value}</span> : p.default ? <span className="text-app-text-tertiary">{t("sameAsDefault")}</span> : <span className={p.required ? "text-app-error" : "text-app-text-tertiary"}>{p.required ? t("missing") : t("none")}</span>}
                          {fromFile ? (
                            <div className="text-xs text-app-info">{t("clientFile")}</div>
                          ) : (
                            <div className="text-xs">
                              <EditClientValue agentId={agent.id} clientId={c.id} clientName={c.name} paramKey={p.key} paramLabel={p.label} value={own ?? ""} example={exampleOf(p)} contacts={p.type === "EMAIL" ? contacts.get(c.id) : undefined} />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-app-border px-5 py-2.5 text-xs text-app-text-secondary">{t("noAiNote")}</p>
        </section>
      )}

      {installParams.length > 0 && (
        <section className="rounded-xl border border-app-border bg-white">
          <div className="border-b border-app-border px-5 py-3">
            <h2 className="text-base font-medium">{t("perInstallation")}</h2>
            <p className="mt-1 text-[13px] text-app-text-secondary">{t("perInstallationIntro")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-[13.5px]">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="px-4 py-2.5 text-start font-normal">{t("installation")}</th>
                  {installParams.map((p) => (
                    <th key={p.key} className="px-4 py-2.5 text-start font-normal">{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {installations.map((i) => {
                  const values = (i.values ?? {}) as Record<string, string>;
                  return (
                    <tr key={i.id} className="border-b border-app-border last:border-0">
                      <td className="px-4 py-3 font-medium">{i.userName}</td>
                      {installParams.map((p) => (
                        <td key={p.key} className="px-4 py-3" dir="auto">{values[p.key] || p.default || <span className={p.required ? "text-app-error" : "text-app-text-tertiary"}>{p.required ? t("missing") : t("none")}</span>}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
