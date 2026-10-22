import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { collectApprovals } from "@/lib/app-domain/approvals";
import { collectQuestionCards } from "@/lib/app-domain/client-questions";
import { countPendingProposals } from "@/lib/app-domain/knowledge-proposals";
import { ViewTabs } from "@/components/app/ViewTabs";
import {
  APPROVAL_TABS,
  KIND_LABELS,
  KIND_TONES,
  approvalsHref,
  bulkRuleGroups,
  forClient,
  parseApprovalsParams,
  tabCounts,
  visibleTabs,
  waitedLabel,
  withApprovalsBack,
  type ApprovalItem,
  type ApprovalTab,
} from "@/lib/approvals";
import { rankApprovals } from "@/lib/next-steps";
import { questionsDraft } from "@/lib/client-questions";
import { ApprovalRow } from "./ApprovalRow";
import { BulkRules } from "./BulkRules";
import { QuestionCardView } from "./QuestionCard";
import { KnowledgeReview } from "../knowledge/KnowledgeReview";

// "אישורים" (Ariel, 20.10.2026; simplified 22.10.2026): only decisions,
// each one with what is recommended and why, and a button that carries it
// out. "היום" on top: what stops work first, then what has a date this
// week. The items not yet confirmed are not decisions of the manager's:
// they are the file owner's "שאלות ללקוח", one card per client, with a
// message to send. lib/approvals.ts holds the tabs; lib/next-steps.ts the
// recommendations and the order.

export const metadata = { robots: { index: false, follow: false } };

export default async function ApprovalsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await props.searchParams;
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) redirect("/app");
  const { tab, clientId } = parseApprovalsParams(params);
  const manager = canManageClients(user.role);
  const everyone = manager && params.scope === "all";
  const now = new Date();
  // Everyone's questions stay everyone's while the client changes.
  const withScope = (href: string) => (everyone && tab === "questions" ? `${href}${href.includes("?") ? "&" : "?"}scope=all` : href);

  const [allItems, myCards, knowledgeAll, knowledgeClient] = await Promise.all([
    collectApprovals(user),
    collectQuestionCards(user),
    countPendingProposals(user),
    clientId ? countPendingProposals(user, clientId) : Promise.resolve(null),
  ]);
  const cards = tab === "questions" && everyone ? await collectQuestionCards(user, { scope: "all" }) : myCards;

  // The client chips count the decisions, the tabs count the chosen client.
  const clients = new Map<string, { name: string; count: number }>();
  for (const i of allItems) {
    if (!i.clientId) continue;
    const c = clients.get(i.clientId) ?? { name: i.clientName ?? "", count: 0 };
    c.count += i.weight ?? 1;
    clients.set(i.clientId, c);
  }
  for (const c of cards) if (!clients.has(c.clientId)) clients.set(c.clientId, { name: c.clientName, count: 0 });

  const items = forClient(allItems, clientId);
  const shownCards = clientId ? cards.filter((c) => c.clientId === clientId) : cards;
  const myQuestions = (clientId ? myCards.filter((c) => c.clientId === clientId) : myCards).reduce((n, c) => n + c.items.filter((i) => !i.askedAt).length, 0);
  const counts = tabCounts(items, myQuestions, clientId ? (knowledgeClient ?? 0) : knowledgeAll);
  const tabs = visibleTabs(counts, tab);

  const rowOf = (i: ApprovalItem, showLabel: boolean) => ({
    kind: i.kind,
    id: i.id,
    version: i.version,
    clientId: i.clientId,
    clientName: i.clientName,
    title: i.title,
    detail: i.detail,
    waited: waitedLabel(i.since, now),
    by: i.by,
    // The way back from the item to this view, tab and client.
    href: withApprovalsBack(i.href, tab, clientId),
    actions: i.actions,
    blocked: i.blocked,
    preview: i.preview ?? null,
    label: KIND_LABELS[i.kind],
    tone: KIND_TONES[i.kind],
    showLabel,
    recommend: i.recommend ?? null,
    op: i.op ?? null,
    go: i.go ? { label: i.go.label, href: withApprovalsBack(i.go.href, tab, clientId) } : null,
  });

  const ofTab = tab === "all" ? items : items.filter((i) => i.kind === tab);
  const ranked = rankApprovals(ofTab, now);
  const groups = tab === "all" || tab === "rule" ? bulkRuleGroups(items) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">אישורים</h1>
        <p className="mt-1 text-sm text-app-text-secondary">מה מחכה להחלטה שלך. בכל שורה: מה מומלץ ולמה, וכפתור שעושה את זה. מה שעוצר עבודה מופיע ראשון.</p>
      </div>

      {clients.size > 0 && (
        <nav aria-label="סינון לפי לקוח" className="flex flex-wrap items-center gap-1.5" data-testid="approvals-clients">
          <a
            href={withScope(approvalsHref(tab, null))}
            aria-current={!clientId ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${!clientId ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary hover:border-app-accent"}`}
          >
            כל הלקוחות
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
                {c.name}
                {c.count > 0 && <span className="ms-1 text-app-text-tertiary">{c.count}</span>}
              </a>
            ))}
        </nav>
      )}

      <ViewTabs
        label="סוגי אישורים"
        active={tab}
        tabs={tabs.map((t) => ({ key: t.key, label: t.count > 0 ? `${t.label} (${t.count})` : t.label, href: approvalsHref(t.key, clientId) }))}
      />

      {tab === "knowledge" ? (
        <KnowledgeReview searchParams={clientId ? { ...params, clientId } : params} />
      ) : tab === "questions" ? (
        <Questions cards={shownCards} manager={manager} everyone={everyone} clientId={clientId} senderName={user.name} tab={tab} />
      ) : ofTab.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary" data-testid="approvals-empty">
          {tab === "all" ? "אין כרגע שום דבר שמחכה להחלטה שלך." : `אין כרגע ${APPROVAL_TABS.find((t) => t.key === tab)?.label ?? ""} שמחכים לך.`}
          {counts.questions > 0 && (
            <>
              {" "}
              <a href={approvalsHref("questions", clientId)} className="text-app-text-accent hover:underline">
                {counts.questions === 1 ? "שאלה אחת ללקוח" : `${counts.questions} שאלות ללקוחות`}
              </a>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.length > 0 && <BulkRules groups={groups} />}
          <section>
            {tab === "all" && ranked.rest.length > 0 && <h2 className="mb-2 text-sm font-medium text-app-text-primary">היום</h2>}
            <ul className="divide-y divide-app-border rounded-2xl border border-app-border bg-white px-5" data-testid={tab === "all" ? "approvals-today" : "approvals-list"}>
              {(tab === "all" ? ranked.today : [...ranked.today, ...ranked.rest]).map((i) => (
                <ApprovalRow key={`${i.kind}:${i.id}`} row={rowOf(i, tab === "all")} />
              ))}
            </ul>
          </section>
          {tab === "all" && ranked.rest.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-app-text-primary">כל השאר ({ranked.rest.length})</h2>
              <ul className="divide-y divide-app-border rounded-2xl border border-app-border bg-white px-5" data-testid="approvals-list">
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

function Questions({
  cards,
  manager,
  everyone,
  clientId,
  senderName,
  tab,
}: {
  cards: Awaited<ReturnType<typeof collectQuestionCards>>;
  manager: boolean;
  everyone: boolean;
  clientId: string | null;
  senderName: string;
  tab: ApprovalTab;
}) {
  const scopeHref = (all: boolean) => {
    const base = approvalsHref(tab, clientId);
    return all ? `${base}${base.includes("?") ? "&" : "?"}scope=all` : base;
  };
  return (
    <div className="space-y-3" data-testid="questions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-app-text-secondary">
          מה שעוד לא אומת בתיק, והשאלות הפתוחות: כרטיס לכל לקוח, אצל מי שאחראי על הפריטים. שואלים את הלקוח בהודעה אחת, וכשהוא עונה, התשובות נכנסות לתיק בחילוץ.
        </p>
        {manager && (
          <div className="flex items-center gap-1.5 text-[12.5px]" data-testid="questions-scope">
            <a href={scopeHref(false)} aria-current={!everyone ? "true" : undefined} className={`rounded-full border px-3 py-1 ${!everyone ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary"}`}>
              שלי
            </a>
            <a href={scopeHref(true)} aria-current={everyone ? "true" : undefined} className={`rounded-full border px-3 py-1 ${everyone ? "border-app-accent bg-app-accent-soft text-app-text-primary" : "border-app-border text-app-text-secondary"}`}>
              של כולם
            </a>
          </div>
        )}
      </div>
      {cards.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">
          {everyone ? "אין כרגע שאלות פתוחות לאף לקוח." : "אין כרגע שאלות שמחכות לך."}
          {manager && !everyone && (
            <>
              {" "}
              <a href={scopeHref(true)} className="text-app-text-accent hover:underline">
                לשאלות של כולם
              </a>
            </>
          )}
        </div>
      ) : (
        cards.map((c) => (
          <QuestionCardView
            key={`${c.clientId}:${c.ownerId ?? "none"}`}
            card={{
              ...c,
              items: c.items.map((i) => ({ ...i, href: withApprovalsBack(i.href, tab, clientId), askedAt: i.askedAt ? i.askedAt.toISOString() : null })),
              draft: questionsDraft({ contactName: c.contactName, senderName, items: c.items.filter((i) => !i.askedAt) }),
            }}
            manager={manager}
          />
        ))
      )}
    </div>
  );
}
