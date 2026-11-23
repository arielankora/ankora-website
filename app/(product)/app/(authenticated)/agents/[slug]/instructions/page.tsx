import { Forbidden } from "@/components/app/Forbidden";
import { CopyValue } from "@/components/app/CopyValue";
import { BLOCK_KINDS } from "@/lib/agents/model";
import { compileAgent } from "@/lib/agents/compile";
import { AgentHeader, loadAgent } from "../shared";
import Link from "next/link";
import { approvedLibrary, listSharedBlocks } from "@/lib/app-domain/agent-library";
import { AddFromLibrary, DeleteBlock, EditBlock, EditMeta } from "../../AgentForms";
import { ACTION_LEVEL_LABEL, BLOCK_KIND_LABEL } from "../../labels";

// Agents, phase 1: "הוראות". The blocks in the order Claude reads them, and
// beside them exactly what Claude receives, for a chosen client.

export const metadata = { robots: { index: false, follow: false } };

function Body({ text }: { text: string }) {
  const parts = text.split(/(\{\{[\p{L}\p{N}_]{1,40}\}\})/u);
  return (
    <p dir="auto" className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-app-text-primary">
      {parts.map((p, i) => (p.startsWith("{{") ? <span key={i} className="rounded bg-app-accent-soft px-1 text-app-text-accent">{p}</span> : p))}
    </p>
  );
}

export default async function InstructionsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ client?: string }> }) {
  const { slug } = await params;
  const { client } = await searchParams;
  const data = await loadAgent(slug);
  if (!data) return <Forbidden />;
  const { agent, content, editing, clients } = data;
  const order = (k: string) => BLOCK_KINDS.indexOf(k as (typeof BLOCK_KINDS)[number]);
  const general = content.blocks.filter((b) => !b.clientId).sort((a, b) => order(a.kind) - order(b.kind));
  const additions = content.blocks.filter((b) => b.clientId);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const previewClients = client ? await data.resolve([client]) : [];
  const preview = editing ? compileAgent({ agent, version: { version: editing.version, ...content }, installation: null, clients: previewClients, library: await approvedLibrary() }) : null;
  const canEdit = !data.draft || data.draft.state === "DRAFT";
  const library = (await listSharedBlocks(data.user)).filter((b) => b.approved).map((b) => ({ key: b.key, title: b.title }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="instructions" />

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-app-text-secondary">
        <span>
          {general.length} קטעים, לפי הסדר שבו Claude קורא אותם · רמת פעולה: {ACTION_LEVEL_LABEL[content.actionLevel]}
          {editing?.changeNote ? ` · שינוי: ${editing.changeNote}` : ""}
        </span>
        {canEdit && <EditMeta agentId={agent.id} actionLevel={content.actionLevel} changeNote={data.draft?.changeNote ?? ""} requirements={content.requirements} />}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5">
          {general.map((b) => (
            <section key={b.key} className={`rounded-xl border bg-white px-4 py-3 ${b.safety ? "border-app-error/40" : "border-app-border"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-app-text-secondary">
                  {BLOCK_KIND_LABEL[b.kind]}{b.safety ? " · גבול בטיחות" : ""}
                  {b.sharedKey && <Link href="/app/agents/library" className="rounded-full bg-app-info-soft px-2 py-0.5 text-app-info">מספרייה, גרסה {b.sharedVersion}</Link>}
                </span>
                {canEdit && (
                  <span className="flex items-center gap-2">
                    {!b.sharedKey && <EditBlock agentId={agent.id} block={b} clients={clients} params={content.params} />}
                    <DeleteBlock agentId={agent.id} blockKey={b.key} />
                  </span>
                )}
              </div>
              <h2 className="mt-1 text-sm font-medium text-app-text-primary" dir="auto">{b.title}</h2>
              <Body text={b.body} />
              {b.why && <p className="mt-1.5 text-xs text-app-text-tertiary" dir="auto">למה: {b.why}</p>}
            </section>
          ))}

          <section className="rounded-xl border border-dashed border-app-accent px-4 py-3">
            <h2 className="text-sm font-medium text-app-text-primary">תוספות ללקוח</h2>
            {additions.length === 0 && <p className="mt-1 text-[13px] text-app-text-secondary">אין. תוספת ללקוח היא קטע שמגיע רק כשהסוכן עובד על הלקוח הזה.</p>}
            {additions.map((b) => (
              <div key={b.key} className="mt-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="me-2 rounded-full bg-app-accent-soft px-2 py-0.5 text-xs text-app-text-accent">{clientName.get(b.clientId!) ?? "לקוח"}</span>
                  <span className="text-sm font-medium" dir="auto">{b.title}</span>
                  <Body text={b.body} />
                </div>
                {canEdit && (
                  <span className="flex items-center gap-2">
                    <EditBlock agentId={agent.id} block={b} clients={clients} params={content.params} />
                    <DeleteBlock agentId={agent.id} blockKey={b.key} />
                  </span>
                )}
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-app-border bg-white px-4 py-3">
            <h2 className="text-sm font-medium text-app-text-primary">קבצים מצורפים</h2>
            {content.files.length === 0 ? (
              <p className="mt-1 text-[13px] text-app-text-secondary">אין. קובץ שההוראות מפנות אליו (סקריפט, תבנית, מסמך רקע) נשמר כאן מ-Claude, ב-save_agent_draft.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {content.files.map((f) => (
                  <li key={f.path}>
                    <details>
                      <summary className="cursor-pointer text-[13.5px] text-app-text-primary" dir="ltr">
                        {f.path} <span className="text-xs text-app-text-tertiary">({f.content.length.toLocaleString("en-US")} תווים)</span>
                      </summary>
                      <pre dir="auto" className="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-app-surface-page p-3 font-jbmono text-[12px] leading-relaxed text-app-text-primary">{f.content}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <EditBlock agentId={agent.id} clients={clients} params={content.params} />
              <AddFromLibrary agentId={agent.id} options={library.filter((l) => !content.blocks.some((b) => b.sharedKey === l.key))} />
            </div>
          )}
        </div>

        <section aria-label="הקובץ ש-Claude מקבל" className="flex min-w-0 flex-[1_1_400px] flex-col rounded-xl border border-app-border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border px-4 py-3">
            <span className="text-[13.5px] font-medium">מה Claude מקבל</span>
            <form className="flex items-center gap-2 text-xs text-app-text-secondary">
              <label htmlFor="preview-client">תצוגה עבור</label>
              <select id="preview-client" name="client" defaultValue={client ?? ""} className="rounded-lg border border-app-border bg-white px-2 py-1 text-xs">
                <option value="">בלי לקוח</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button type="submit" className="rounded-full border border-app-border px-2.5 py-1">להציג</button>
            </form>
          </div>
          {preview ? (
            <div className="space-y-2 p-4">
              <pre dir="rtl" className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg bg-app-surface-page p-3 font-jbmono text-[12.5px] leading-relaxed text-app-text-primary">{preview.text}</pre>
              <CopyValue value={preview.text} label="ההוראות המלאות" />
            </div>
          ) : (
            <p className="p-4 text-sm text-app-text-secondary">אין עדיין גרסה.</p>
          )}
        </section>
      </div>
    </div>
  );
}
