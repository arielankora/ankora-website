import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { DomainError } from "@/lib/domain-error";
import { ViewTabs } from "@/components/app/ViewTabs";
import { contentOf, getAgent, resolveClients } from "@/lib/app-domain/agents";
import type { VersionProblem } from "@/lib/agents/model";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { ArchiveAgent, DraftButtons, EditPurpose } from "../AgentForms";

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

/// ADR 0006: a version's or a client addition's checks, in the reader's
/// language, by code. A check the dictionary does not know keeps its Hebrew.
export async function problemWords() {
  const t = await getTranslations("agents.versions.problems");
  return (p: VersionProblem) => {
    if (!t.has(p.code as "dash")) return p.text;
    const values = p.code === "undefinedParam" ? { placeholder: `{{${p.values?.key ?? ""}}}` } : p.values;
    return t(p.code as "dash", values as never);
  };
}

export type LoadedAgent = NonNullable<Awaited<ReturnType<typeof loadAgent>>>;

const TABS = [
  { key: "overview", path: "" },
  { key: "instructions", path: "/instructions" },
  { key: "params", path: "/params" },
  { key: "versions", path: "/versions" },
  { key: "installations", path: "/installations" },
] as const;

export async function AgentHeader({ data, active }: { data: LoadedAgent; active: (typeof TABS)[number]["key"] }) {
  const { agent, approved, draft } = data;
  const t = await getTranslations("agents.header");
  const tl = await getTranslations("agents.labels");
  return (
    <div className="space-y-4">
      <div className="text-[13px] text-app-text-secondary">
        <Link href="/app/agents" className="hover:underline">{t("crumb")}</Link> / <span dir="auto">{agent.name}</span>
      </div>
      <div>
        <h1 className="text-xl font-medium text-app-text-primary" dir="auto">{agent.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-app-text-secondary" dir="auto">{agent.purpose}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-app-text-secondary">
          <span className="rounded-full border border-app-border bg-white px-2.5 py-0.5">{tl(`kind.${agent.kind}`)}</span>
          {agent.ownerName && <span className="rounded-full border border-app-border bg-white px-2.5 py-0.5">{t("owner", { name: agent.ownerName })}</span>}
          <span className="rounded-full border border-app-border bg-white px-2.5 py-0.5">{approved ? t("approvedVersion", { version: approved.version }) : t("noApproved")}</span>
          {approved && <a href={`/api/agents/${agent.slug}/export`} className="rounded-full border border-app-border bg-white px-2.5 py-0.5 text-app-text-accent">{t("export")}</a>}
          {data.canDecide && <EditPurpose agentId={agent.id} purpose={agent.purpose} />}
          {data.canDecide && <ArchiveAgent agentId={agent.id} name={agent.name} />}
        </div>
      </div>
      <ViewTabs label={t("tabsLabel")} active={active} tabs={TABS.map((tab) => ({ key: tab.key, label: t(`tabs.${tab.key}`), href: `/app/agents/${agent.slug}${tab.path}` }))} />
      {draft && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-app-accent-soft px-4 py-3">
          <div className="text-[13.5px] text-app-text-primary">
            {draft.state === "PENDING" ? (
              <><strong className="font-medium">{t("pendingTitle", { version: draft.version })}</strong> {approved ? t("pendingKeepsVersion", { version: approved.version }) : t("pendingKeeps")}</>
            ) : (
              <><strong className="font-medium">{t("draftTitle", { version: draft.version })}</strong> {approved ? t("draftKeepsVersion", { version: approved.version }) : t("draftFirst")}</>
            )}
          </div>
          {draft.state === "DRAFT" && <DraftButtons versionId={draft.id} canDiscard={!!approved} />}
        </div>
      )}
    </div>
  );
}
