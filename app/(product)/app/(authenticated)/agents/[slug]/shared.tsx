import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { DomainError } from "@/lib/domain-error";
import { ViewTabs } from "@/components/app/ViewTabs";
import { contentOf, getAgent, resolveClients } from "@/lib/app-domain/agents";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { ArchiveAgent, DraftButtons, EditPurpose } from "../AgentForms";
import { KIND_LABEL } from "../labels";

// Agents, phase 1: what every tab of one agent reads, and the header and
// tabs they share.

export async function loadAgent(slug: string) {
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) return null;
  let data;
  try {
    data = await getAgent(user, decodeURIComponent(slug));
  } catch (err) {
    if (err instanceof DomainError) notFound();
    throw err;
  }
  const editing = data.draft ?? data.approved;
  const content = editing ? contentOf(editing) : { blocks: [], params: [], requirements: { connectors: [], skills: [], repos: [], localMcp: [], externalRunners: [] }, actionLevel: "READ" as const, files: [] };
  const clients = (await listAccessibleClients(user)).map((c) => ({ id: c.id, name: c.name }));
  return { user, ...data, editing, content, clients, resolve: (ids: string[]) => resolveClients(user, data.agent.id, content.params, { clientScope: "LIST", clientIds: ids }) };
}

export type LoadedAgent = NonNullable<Awaited<ReturnType<typeof loadAgent>>>;

const TABS = [
  { key: "overview", label: "סקירה", path: "" },
  { key: "instructions", label: "הוראות", path: "/instructions" },
  { key: "params", label: "פרמטרים", path: "/params" },
  { key: "versions", label: "גרסאות", path: "/versions" },
  { key: "installations", label: "התקנות", path: "/installations" },
] as const;

export function AgentHeader({ data, active }: { data: LoadedAgent; active: (typeof TABS)[number]["key"] }) {
  const { agent, approved, draft } = data;
  return (
    <div className="space-y-4">
      <div className="text-[13px] text-app-text-secondary">
        <Link href="/app/agents" className="hover:underline">סוכנים</Link> / {agent.name}
      </div>
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{agent.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-app-text-secondary">{agent.purpose}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-app-text-secondary">
          <span className="rounded-full border border-app-border bg-white px-2.5 py-0.5">{KIND_LABEL[agent.kind]}</span>
          {agent.ownerName && <span className="rounded-full border border-app-border bg-white px-2.5 py-0.5">אחראי: {agent.ownerName}</span>}
          <span className="rounded-full border border-app-border bg-white px-2.5 py-0.5">{approved ? `גרסה ${approved.version} מאושרת` : "אין גרסה מאושרת"}</span>
          {approved && <a href={`/api/agents/${agent.slug}/export`} className="rounded-full border border-app-border bg-white px-2.5 py-0.5 text-app-text-accent">להוריד כסקיל (SKILL.md)</a>}
          {data.canDecide && <EditPurpose agentId={agent.id} purpose={agent.purpose} />}
          {data.canDecide && <ArchiveAgent agentId={agent.id} name={agent.name} />}
        </div>
      </div>
      <ViewTabs label="לשוניות הסוכן" active={active} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/app/agents/${agent.slug}${t.path}` }))} />
      {draft && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-accent-soft px-4 py-3">
          <div className="text-[13.5px] text-app-text-primary">
            {draft.state === "PENDING" ? (
              <><strong className="font-medium">גרסה {draft.version} ממתינה לאישור מנהל.</strong> ההתקנות ממשיכות על {approved ? `גרסה ${approved.version}` : "מה שיש להן"} עד האישור.</>
            ) : (
              <><strong className="font-medium">טיוטה לגרסה {draft.version}.</strong> {approved ? `ההתקנות ממשיכות לרוץ על גרסה ${approved.version} עד שמנהל יאשר.` : "אחרי אישור מנהל אפשר יהיה להתקין את הסוכן."}</>
            )}
          </div>
          {draft.state === "DRAFT" && <DraftButtons versionId={draft.id} canDiscard={!!approved} />}
        </div>
      )}
    </div>
  );
}
