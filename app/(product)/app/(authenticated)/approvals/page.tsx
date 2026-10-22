import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { collectApprovals, collectReview } from "@/lib/app-domain/approvals";
import { countPendingProposals } from "@/lib/app-domain/knowledge-proposals";
import { ViewTabs } from "@/components/app/ViewTabs";
import {
  APPROVAL_TABS,
  KIND_LABELS,
  KIND_TONES,
  REVIEW_LABELS,
  approvalsHref,
  forClient,
  parseApprovalsParams,
  sortByWaiting,
  tabCounts,
  visibleTabs,
  waitedLabel,
  withApprovalsBack,
  type ApprovalItem,
  type ReviewItem,
} from "@/lib/approvals";
import { ApprovalRow, KindLabel } from "./ApprovalRow";
import { KnowledgeReview } from "../knowledge/KnowledgeReview";

// "אישורים" (Ariel, 20.10.2026): every manual approval in one place, a
// tab for each kind, and "לבדיקה" for what is to check rather than to
// approve. lib/approvals.ts holds the tabs and their order;
// lib/app-domain/approvals.ts reads the rows, each scoped to who may
// decide it.

export const metadata = { robots: { index: false, follow: false } };

const EMPTY: Record<string, string> = {
  all: "אין כרגע שום דבר שמחכה לאישור שלך.",
  review: "אין כרגע פריטים לבדיקה.",
};

export default async function ApprovalsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await props.searchParams;
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) redirect("/app");
  const { tab, clientId } = parseApprovalsParams(params);
  const now = new Date();

  const [allItems, allReview, knowledgeAll, knowledgeClient] = await Promise.all([
    collectApprovals(user),
    collectReview(user),
    countPendingProposals(user),
    clientId ? countPendingProposals(user, clientId) : Promise.resolve(null),
  ]);

  // The client chips count everything, the tabs count the chosen client.
  const clients = new Map<string, { name: string; count: number }>();
  for (const i of allItems) {
    if (!i.clientId) continue;
    const c = clients.get(i.clientId) ?? { name: i.clientName ?? "", count: 0 };
    c.count += i.weight ?? 1;
    clients.set(i.clientId, c);
  }
  for (const r of allReview) if (r.clientId && !clients.has(r.clientId)) clients.set(r.clientId, { name: r.clientName ?? "", count: 0 });

  const items = forClient(allItems, clientId);
  const review = forClient(allReview, clientId);
  const counts = tabCounts(items, review, clientId ? (knowledgeClient ?? 0) : knowledgeAll);
  const tabs = visibleTabs(counts, tab);

  const rowsOf = (list: ApprovalItem[], showLabel: boolean) =>
    sortByWaiting(list).map((i) => ({
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
    }));

  const shown = tab === "all" ? rowsOf(items, true) : tab === "review" || tab === "knowledge" ? [] : rowsOf(items.filter((i) => i.kind === tab), false);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">אישורים</h1>
        <p className="mt-1 text-sm text-app-text-secondary">
          כל מה שמחכה לאישור שלך, בלשונית לכל סוג. כל כפתור כאן עושה בדיוק מה שהוא עושה במקום של הפריט, עם אותן בדיקות.
        </p>
      </div>

      {clients.size > 0 && (
        <nav aria-label="סינון לפי לקוח" className="flex flex-wrap items-center gap-1.5" data-testid="approvals-clients">
          <a
            href={approvalsHref(tab, null)}
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
                href={approvalsHref(tab, id)}
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
      ) : tab === "review" ? (
        <ReviewList rows={sortByWaiting(review).map((r) => ({ ...r, href: withApprovalsBack(r.href, tab, clientId) }))} now={now} />
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary" data-testid="approvals-empty">
          {EMPTY[tab] ?? `אין כרגע ${APPROVAL_TABS.find((t) => t.key === tab)?.label ?? ""} שמחכים לך.`}
          {tab === "all" && counts.review > 0 && (
            <>
              {" "}
              <a href={approvalsHref("review", clientId)} className="text-app-text-accent hover:underline">
                {counts.review === 1 ? "פריט אחד לבדיקה" : `${counts.review} פריטים לבדיקה`}
              </a>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-app-border rounded-2xl border border-app-border bg-white px-5" data-testid="approvals-list">
          {shown.map((r) => (
            <ApprovalRow key={`${r.kind}:${r.id}`} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewList({ rows, now }: { rows: ReviewItem[]; now: Date }) {
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-app-border bg-white p-8 text-center text-sm text-app-text-tertiary">{EMPTY.review}</div>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-app-text-tertiary">אלה לא אישורים: דברים לבדוק ולסגור במקום שלהם. הקישור בכל שורה מוביל לשם.</p>
      <ul className="divide-y divide-app-border rounded-2xl border border-app-border bg-white px-5" data-testid="review-list">
        {rows.map((r) => (
          <li key={`${r.kind}:${r.id}`} className="flex flex-wrap items-start justify-between gap-3 py-3.5" data-testid="review-row" data-kind={r.kind}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <KindLabel label={REVIEW_LABELS[r.kind]} tone="neutral" />
                <a href={r.href} className="text-[14px] font-medium text-app-text-primary hover:text-app-text-accent hover:underline">
                  {r.title}
                </a>
              </div>
              {r.detail && <p className="mt-1 text-[12.5px] leading-relaxed text-app-text-secondary">{r.detail}</p>}
              <p className="mt-1 text-[11.5px] text-app-text-tertiary">{[r.clientName, waitedLabel(r.since, now)].filter(Boolean).join(" · ")}</p>
            </div>
            <a href={r.href} className="shrink-0 text-[12.5px] font-medium text-app-text-accent hover:underline">
              לפתוח
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
