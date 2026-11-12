import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { collectApprovals, countMyPendingProposals } from "@/lib/app-domain/approvals";
import { countAutoReview } from "@/lib/app-domain/auto-apply";
import { ViewTabs } from "@/components/app/ViewTabs";
import {
  APPROVAL_DATE_FORMATS,
  KIND_TONES,
  approvalsHref,
  bulkRuleGroups,
  forClient,
  onlyMine,
  parseApprovalsParams,
  questionsRedirect,
  tabCounts,
  visibleTabs,
  waitedDays,
  withApprovalsBack,
  type ApprovalItem,
  type ApprovalText,
} from "@/lib/approvals";
import { rankApprovals } from "@/lib/next-steps";
import { ApprovalRow } from "./ApprovalRow";
import { procedureWords, stepTextWords, type LooseT } from "./procedure-words";
import { BulkRules } from "./BulkRules";
import { aiExcludedClientIds, aiExcludedTaskIds } from "@/lib/app-domain/ai-exclusion-db";
import { KnowledgeReview } from "../knowledge/KnowledgeReview";

// "אישורים" (Ariel, 20.10.2026; simplified 22.10.2026): only decisions,
// each one with what is recommended and why, and a button that carries it
// out. "היום" on top: what stops work first, then what has a date this
// week. The questions for a client are not decisions: since 1.11.2026
// they live on the client's page ("מה לברר עם הלקוח"), and the old
// addresses of their tab lead there. lib/approvals.ts holds the tabs;
// lib/next-steps.ts the recommendations and the order.

export const metadata = { robots: { index: false, follow: false } };

export default async function ApprovalsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await props.searchParams;
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) redirect("/app");
  const moved = questionsRedirect(params);
  if (moved) redirect(moved);
  const { tab, clientId } = parseApprovalsParams(params);
  // "של כולם" (22.10.2026): the meetings other people sent too. A chosen
  // client shows that client's meetings whoever sent them.
  const everyone = params.scope === "all";
  const now = new Date();
  // "של כולם" stays while the tab or the client changes.
  const withScope = (href: string) => (everyone ? `${href}${href.includes("?") ? "&" : "?"}scope=all` : href);
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  // A row's words are keys under approvals.items that lib/app-domain/
  // approvals.ts chose at runtime, so they are looked up untyped here;
  // ApprovalItemKey checks them against he.json where they are written.
  const tItems = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  // A process decision and a procedure's preview are worded from what lib
  // gives as keys and data (./procedure-words.ts).
  const tProc = (await getTranslations("clients.processes")) as unknown as LooseT;
  const tPrev = (await getTranslations("approvals.preview")) as unknown as LooseT;
  const say = (m: ApprovalText): string =>
    tItems(
      `items.${m.key}`,
      Object.fromEntries(
        Object.entries(m.values ?? {}).map(([name, v]) => [
          name,
          typeof v === "string" || typeof v === "number" ? v : "key" in v ? say(v) : format.dateTime(v.date, APPROVAL_DATE_FORMATS[v.as]),
        ])
      )
    );
  const waited = (since: Date) => {
    const days = waitedDays(since, now);
    return days <= 0 ? t("waited.today") : days === 1 ? t("waited.yesterday") : t("waited.days", { count: String(days) });
  };

  const [everything, knowledgeAll, knowledgeClient, autoReview] = await Promise.all([
    collectApprovals(user),
    countMyPendingProposals(user, { everyone }),
    clientId ? countMyPendingProposals(user, { clientId, everyone: true }) : Promise.resolve(null),
    // 3.11.2026: items that entered a file on their own and still need a
    // look count on "ידע מהחילוץ", so the tab is there while they wait.
    countAutoReview(user, { clientId }),
  ]);
  const allItems = everyone ? everything : onlyMine(everything);

  // ADR 0006: a row of a client marked "בלי AI", or of a marked task (a
  // task's approval and a plan are decided on the task's id), is kept from
  // the browser's translator. The rule is lib/ai-exclusion.ts's, asked
  // through its database helpers.
  const [excludedClients, excludedTasks] = await Promise.all([
    aiExcludedClientIds(everything.flatMap((i) => (i.clientId ? [i.clientId] : []))),
    aiExcludedTaskIds(everything.filter((i) => i.kind === "task" || i.kind === "plan").map((i) => i.id)),
  ]);
  const rowExcluded = (i: ApprovalItem) =>
    (!!i.clientId && excludedClients.has(i.clientId)) || ((i.kind === "task" || i.kind === "plan") && excludedTasks.has(i.id));

  // The client chips count the decisions, the tabs count the chosen client.
  const clients = new Map<string, { name: string; count: number }>();
  for (const i of allItems) {
    if (!i.clientId) continue;
    const c = clients.get(i.clientId) ?? { name: i.clientName ?? "", count: 0 };
    c.count += i.weight ?? 1;
    clients.set(i.clientId, c);
  }

  const items = clientId ? forClient(everything, clientId) : allItems;
  const counts = tabCounts(items, (clientId ? (knowledgeClient ?? 0) : knowledgeAll) + autoReview);
  const tabs = visibleTabs(counts, tab);

  // The row in the reader's words: a key from `screen` where the domain
  // gave one, otherwise the field as it is (a title someone wrote, a
  // process decision's words from lib/next-steps.ts).
  const rowOf = (i: ApprovalItem, showLabel: boolean) => {
    const w = i.screen ?? {};
    const st = i.stepText;
    const proc = i.procedureWords ? procedureWords(tProc, tPrev, i.procedureWords) : null;
    const preview =
      proc && i.preview
        ? {
            ...i.preview,
            sections: i.preview.sections.map((sec) =>
              sec.headingKey === "steps" ? { ...sec, lines: proc.steps } : sec.headingKey === "excepted" ? { ...sec, lines: proc.excepted } : sec
            ),
          }
        : (i.preview ?? null);
    return {
      kind: i.kind,
      id: i.id,
      version: i.version,
      clientId: i.clientId,
      clientName: i.clientName,
      title: w.title ? say(w.title) : i.title,
      detail: w.detail ? say(w.detail) : st ? stepTextWords(tProc, st.title, i.detail ?? "") : i.detail,
      waited: waited(i.since),
      by: i.by,
      // The way back from the item to this view, tab and client.
      href: withApprovalsBack(i.href, tab, clientId),
      actions: {
        approve: i.actions.approve && w.approve ? say(w.approve) : i.actions.approve && st ? stepTextWords(tProc, st.fix, i.actions.approve) : i.actions.approve,
        reject: i.actions.reject ? { ...i.actions.reject, label: w.reject ? say(w.reject) : i.actions.reject.label } : null,
      },
      blocked: w.blocked ? say(w.blocked) : i.blocked,
      failing: i.failing ? (proc?.problems ?? i.failing) : null,
      preview,
      label: t(`kinds.${i.kind}`),
      tone: KIND_TONES[i.kind],
      showLabel,
      recommend: w.recommend
        ? { text: say(w.recommend.text), why: w.recommend.why ? say(w.recommend.why) : null }
        : i.recommend && st
          ? { text: stepTextWords(tProc, st.recommend, i.recommend.text), why: i.recommend.why ? stepTextWords(tProc, st.why, i.recommend.why) : null }
          : (i.recommend ?? null),
      op: i.op ?? null,
      aiExcluded: rowExcluded(i),
      go: i.go ? { label: w.go ? say(w.go) : st ? stepTextWords(tProc, st.fix, i.go.label) : i.go.label, href: withApprovalsBack(i.go.href, tab, clientId) } : null,
    };
  };

  const ofTab = tab === "all" ? items : items.filter((i) => i.kind === tab);
  const ranked = rankApprovals(ofTab, now);
  const groups = tab === "all" || tab === "rule" ? bulkRuleGroups(items) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-app-text-secondary">{t("intro")}</p>
      </div>

      {clients.size > 0 && (
        <nav aria-label={t("clientsNav")} className="flex flex-wrap items-center gap-1.5" data-testid="approvals-clients">
          <a
            href={withScope(approvalsHref(tab, null))}
            aria-current={!clientId ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${!clientId ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary hover:border-app-accent"}`}
          >
            {t("allClients")}
          </a>
          {[...clients.entries()]
            .sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name, "he"))
            .map(([id, c]) => (
              <a
                key={id}
                href={withScope(approvalsHref(tab, id))}
                aria-current={clientId === id ? "true" : undefined}
                className={`rounded-full border px-3 py-1 text-[12.5px] ${clientId === id ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary hover:border-app-accent"}`}
              >
                <span dir="auto">{c.name}</span>
                {c.count > 0 && <span className="ms-1 text-app-text-tertiary">{c.count}</span>}
              </a>
            ))}
        </nav>
      )}

      <ViewTabs
        label={t("tabsLabel")}
        active={tab}
        tabs={tabs.map((v) => {
          const label = t(`tabs.${v.key}`);
          return { key: v.key, label: v.count > 0 ? t("tabWithCount", { label, count: String(v.count) }) : label, href: withScope(approvalsHref(v.key, clientId)) };
        })}
      />

      {!clientId && (
        <ScopeToggle
          everyone={everyone}
          mineHref={approvalsHref(tab, clientId)}
          allHref={`${approvalsHref(tab, clientId)}${approvalsHref(tab, clientId).includes("?") ? "&" : "?"}scope=all`}
          hidden={everything.length - allItems.length}
          words={{ mine: t("scope.mine"), everyone: t("scope.everyone"), hidden: t("scope.hidden", { count: everything.length - allItems.length }) }}
        />
      )}

      {tab === "knowledge" ? (
        <KnowledgeReview searchParams={clientId ? { ...params, clientId } : params} mineOnly={!everyone && !clientId} />
      ) : ofTab.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary" data-testid="approvals-empty">
          {tab === "all" ? t("empty.all") : t("empty.tab", { tab: t(`tabs.${tab}`) })}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.length > 0 && <BulkRules groups={groups} />}
          <section>
            {tab === "all" && ranked.rest.length > 0 && <h2 className="mb-2 text-sm font-medium text-app-text-primary">{t("today")}</h2>}
            <ul className="divide-y divide-app-border overflow-hidden rounded-2xl border border-app-border bg-white px-5" data-testid={tab === "all" ? "approvals-today" : "approvals-list"}>
              {(tab === "all" ? ranked.today : [...ranked.today, ...ranked.rest]).map((i) => (
                <ApprovalRow key={`${i.kind}:${i.id}`} row={rowOf(i, tab === "all")} />
              ))}
            </ul>
          </section>
          {tab === "all" && ranked.rest.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-app-text-primary">{t("rest", { count: String(ranked.rest.length) })}</h2>
              <ul className="divide-y divide-app-border overflow-hidden rounded-2xl border border-app-border bg-white px-5" data-testid="approvals-list">
                {ranked.rest.map((i) => (
                  <ApprovalRow key={`${i.kind}:${i.id}`} row={rowOf(i, true)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/// "שלי" or "של כולם", on the decisions (22.10.2026): the meetings other
/// people sent wait on them, and are here only on asking.
function ScopeToggle({
  everyone,
  mineHref,
  allHref,
  hidden,
  words,
}: {
  everyone: boolean;
  mineHref: string;
  allHref: string;
  hidden: number;
  words: { mine: string; everyone: string; hidden: string };
}) {
  if (!everyone && hidden === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]" data-testid="approvals-scope">
      <a href={mineHref} aria-current={!everyone ? "true" : undefined} className={`rounded-full border px-3 py-1 ${!everyone ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary"}`}>
        {words.mine}
      </a>
      <a href={allHref} aria-current={everyone ? "true" : undefined} className={`rounded-full border px-3 py-1 ${everyone ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary"}`}>
        {words.everyone}
      </a>
      {!everyone && hidden > 0 && <span className="text-app-text-tertiary">{words.hidden}</span>}
    </div>
  );
}
