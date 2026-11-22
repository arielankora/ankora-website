import { Forbidden } from "@/components/app/Forbidden";
import { AgentHeader, loadAgent } from "../shared";
import { DeleteParam, EditClientValue, EditParam } from "../../AgentForms";
import { PARAM_LEVEL_LABEL, PARAM_TYPE_LABEL } from "../../labels";

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
  const typed = new Map(data.clientValues.map((v) => [`${v.clientId}:${v.key}`, v.value]));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="params" />

      <p className="text-[13px] text-app-text-secondary">הערך הקרוב ביותר גובר: ברירת המחדל של הסוכן, ואחריה ערך של הלקוח או של ההתקנה. ערך מתיק הלקוח נערך בתיק עצמו, כך ששום דבר לא נכתב פעמיים.</p>

      <section className="rounded-xl border border-app-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border px-5 py-3">
          <h2 className="text-base font-medium">הפרמטרים</h2>
          {canEdit && <EditParam agentId={agent.id} />}
        </div>
        {content.params.length === 0 ? (
          <p className="px-5 py-4 text-sm text-app-text-secondary">אין פרמטרים. פרמטר הוא ערך שמשתנה לפי לקוח או לפי מי שמריץ, ונכתב בהוראות כ-{"{{שם}}"}.</p>
        ) : (
          <ul className="divide-y divide-app-border">
            {content.params.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <span className="font-medium">{p.label}</span> <span className="text-xs text-app-text-tertiary" dir="auto">{`{{${p.key}}}`}</span>
                  <div className="text-xs text-app-text-secondary">
                    {PARAM_LEVEL_LABEL[p.level]} · {PARAM_TYPE_LABEL[p.type]}
                    {p.required ? " · חובה" : ""}
                    {p.clientField ? " · מתיק הלקוח" : ""}
                    {p.default ? ` · ברירת מחדל: ${p.default}` : ""}
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
            <h2 className="text-base font-medium">לפי לקוח</h2>
            <div className="flex flex-wrap gap-3 text-xs text-app-text-secondary">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-app-border-strong" />ברירת מחדל</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-app-info" />מתיק הלקוח</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-app-accent" />הוגדר ללקוח בסוכן</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13.5px]">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="px-4 py-2.5 text-start font-normal">לקוח</th>
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
                          {value ? <span dir="auto">{value}</span> : p.default ? <span className="text-app-text-tertiary">כמו ברירת המחדל</span> : <span className={p.required ? "text-app-error" : "text-app-text-tertiary"}>{p.required ? "חסר" : "אין"}</span>}
                          {fromFile ? (
                            <div className="text-xs text-app-info">תיק הלקוח</div>
                          ) : (
                            <div className="text-xs">
                              <EditClientValue agentId={agent.id} clientId={c.id} clientName={c.name} paramKey={p.key} paramLabel={p.label} value={own ?? ""} />
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
          <p className="border-t border-app-border px-5 py-2.5 text-xs text-app-text-secondary">לקוחות שמסומנים &quot;בלי AI&quot; לא מופיעים כאן, ולא מגיעים לאף סוכן.</p>
        </section>
      )}

      {installParams.length > 0 && (
        <section className="rounded-xl border border-app-border bg-white">
          <div className="border-b border-app-border px-5 py-3">
            <h2 className="text-base font-medium">לפי התקנה</h2>
            <p className="mt-1 text-[13px] text-app-text-secondary">ערכים ששייכים לחשבון של מי שמריץ, לא ללקוח. נקבעים כשיוצרים התקנה.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-[13.5px]">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="px-4 py-2.5 text-start font-normal">התקנה</th>
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
                        <td key={p.key} className="px-4 py-3" dir="auto">{values[p.key] || p.default || <span className={p.required ? "text-app-error" : "text-app-text-tertiary"}>{p.required ? "חסר" : "אין"}</span>}</td>
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
