import { Forbidden } from "@/components/app/Forbidden";
import { CopyValue } from "@/components/app/CopyValue";
import { BLOCK_KINDS, canReplace, parseBlocks } from "@/lib/agents/model";
import { diffBlocks } from "@/lib/agents/diff";
import { approvedAdditions, listClientAdditions } from "@/lib/app-domain/agent-client-additions";
import { compileAgent } from "@/lib/agents/compile";
import { changeNotePrompt } from "@/lib/agents/change-note-prompt";
import { contentOf } from "@/lib/app-domain/agents";
import { AgentHeader, loadAgent } from "../shared";
import Link from "next/link";
import { approvedLibrary, listSharedBlocks } from "@/lib/app-domain/agent-library";
import { AddFromLibrary, AdditionDraftButtons, DecideVersion, DeleteAdditionBlock, DeleteBlock, EditAdditionBlock, EditAdditionNote, EditBlock, EditMeta } from "../../AgentForms";
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
  const previewClients = client ? await data.resolve([client]) : [];
  const preview = editing ? compileAgent({ agent, version: { version: editing.version, ...content }, installation: null, clients: previewClients, library: await approvedLibrary(), additions: await approvedAdditions(agent.id, previewClients.map((c) => c.id)) }) : null;
  // 24.11.2026: client additions are versioned on their own, apart from the agent's draft.
  const additions = await listClientAdditions(data.user, agent.id);
  const workable = (await data.resolve(clients.map((c) => c.id))).map((c) => ({ id: c.id, name: c.name }));
  const approvedBlocks = data.approved ? parseBlocks(data.approved.blocks) : [];
  const targets = approvedBlocks.filter(canReplace).map((b) => ({ key: b.key, title: b.title }));
  const titleOf = new Map(approvedBlocks.map((b) => [b.key, b.title]));
  const canEdit = !data.draft || data.draft.state === "DRAFT";
  const notePrompt = data.draft?.state === "DRAFT" ? changeNotePrompt({ agentName: agent.name, before: data.approved ? contentOf(data.approved) : null, after: content }) : undefined;
  const library = (await listSharedBlocks(data.user)).filter((b) => b.approved).map((b) => ({ key: b.key, title: b.title }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AgentHeader data={data} active="instructions" />

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-app-text-secondary">
        <span>
          {general.length} קטעים, לפי הסדר שבו Claude קורא אותם · רמת פעולה: {ACTION_LEVEL_LABEL[content.actionLevel]}
          {editing?.changeNote ? ` · שינוי: ${editing.changeNote}` : ""}
        </span>
        {canEdit && <EditMeta agentId={agent.id} actionLevel={content.actionLevel} changeNote={data.draft?.changeNote ?? ""} requirements={content.requirements} notePrompt={notePrompt} />}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5">
          {general.map((b) => (
            <section key={b.key} className={`rounded-xl border bg-white px-4 py-3 ${b.safety ? "border-app-error/40" : "border-app-border"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-app-text-secondary">
                  {BLOCK_KIND_LABEL[b.kind]}{b.safety ? " · גבול בטיחות" : b.overridable ? " · ניתן להחלפה ללקוח" : ""}
                  {b.sharedKey && <Link href="/app/agents/library" className="rounded-full bg-app-info-soft px-2 py-0.5 text-app-info">מספרייה, גרסה {b.sharedVersion}</Link>}
                </span>
                {canEdit && (
                  <span className="flex items-center gap-2">
                    {!b.sharedKey && <EditBlock agentId={agent.id} block={b} params={content.params} />}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-app-text-primary">תוספות ללקוח</h2>
              {workable.length > 0 && <EditAdditionBlock agentId={agent.id} clients={workable} targets={targets} />}
            </div>
            <p className="mt-1 text-[13px] text-app-text-secondary">קטעים שמגיעים רק כשהסוכן עובד על הלקוח. לכל לקוח גרסאות משלו, ושינוי בהן לא משנה את גרסת הסוכן.</p>
            {additions.map((a) => {
              const shown = a.open ?? a.approved!;
              const blocks = parseBlocks(shown.blocks);
              const status = a.open ? new Map(diffBlocks(parseBlocks(a.approved?.blocks), blocks).changes.map((c) => [c.key, c.status])) : new Map<string, string>();
              const removed = a.open ? diffBlocks(parseBlocks(a.approved?.blocks), blocks).changes.filter((c) => c.status === "removed") : [];
              const editable = a.open?.state !== "PENDING";
              return (
                <div key={a.clientId} className="mt-3 rounded-lg border border-app-border bg-white px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-full bg-app-accent-soft px-2 py-0.5 text-xs text-app-text-accent">{a.clientName}</span>
                      <span className="text-xs text-app-text-secondary">
                        {a.approved ? `גרסה ${a.approved.version} בשימוש` : "אין גרסה מאושרת"}
                        {a.open ? (a.open.state === "PENDING" ? ` · גרסה ${a.open.version} ממתינה לאישור מנהל` : ` · טיוטה לגרסה ${a.open.version}`) : ""}
                      </span>
                    </span>
                    {editable && (
                      <span className="flex items-center gap-2">
                        <EditAdditionBlock agentId={agent.id} clientId={a.clientId} clientName={a.clientName} clients={workable} targets={targets} />
                        {a.open && <EditAdditionNote agentId={agent.id} clientId={a.clientId} changeNote={a.open.changeNote ?? ""} />}
                      </span>
                    )}
                  </div>
                  {a.open?.changeNote && <p className="mt-1 text-xs text-app-text-secondary" dir="auto">שינוי: {a.open.changeNote}</p>}
                  {blocks.length === 0 && <p className="mt-1 text-[13px] text-app-text-secondary">אין קטעים בגרסה הזו.</p>}
                  {blocks.map((b) => (
                    <div key={b.key} className="mt-2 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-sm font-medium" dir="auto">{b.title}</span>
                        <span className="ms-2 text-xs text-app-text-secondary">
                          {BLOCK_KIND_LABEL[b.kind]}
                          {b.replaces ? ` · במקום "${titleOf.get(b.replaces) ?? b.replaces}"` : ""}
                          {status.get(b.key) === "added" ? " · נוסף" : status.get(b.key) === "changed" ? " · שונה" : ""}
                        </span>
                        <Body text={b.body} />
                      </div>
                      {editable && (
                        <span className="flex items-center gap-2">
                          <EditAdditionBlock agentId={agent.id} clientId={a.clientId} clients={workable} block={b} targets={targets} />
                          <DeleteAdditionBlock agentId={agent.id} clientId={a.clientId} blockKey={b.key} />
                        </span>
                      )}
                    </div>
                  ))}
                  {removed.length > 0 && <p className="mt-2 text-xs text-app-error">הוסרו בטיוטה: {removed.map((r) => r.title).join(", ")}</p>}
                  {a.problems.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-app-error">
                      {a.problems.map((p) => <li key={p}>! {p}</li>)}
                    </ul>
                  )}
                  {a.open?.state === "DRAFT" && <div className="mt-3"><AdditionDraftButtons id={a.open.id} canDiscard /></div>}
                  {a.open?.state === "PENDING" && data.canDecide && <div className="mt-3"><DecideVersion id={a.open.id} version={a.open.version} /></div>}
                </div>
              );
            })}
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
              <EditBlock agentId={agent.id} params={content.params} />
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
              {data.approved && previewClients.length === 1 && <a href={`/api/agents/${agent.slug}/export?client=${previewClients[0].id}`} className="block text-xs text-app-text-accent">להוריד כסקיל ללקוח הזה (SKILL.md)</a>}
            </div>
          ) : (
            <p className="p-4 text-sm text-app-text-secondary">אין עדיין גרסה.</p>
          )}
        </section>
      </div>
    </div>
  );
}
