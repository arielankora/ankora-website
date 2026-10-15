import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { listOpenBatches } from "@/lib/app-domain/knowledge-proposals";
import { readSourceRefs, formatSourceRef, SOURCE_KIND_LABELS } from "@/lib/knowledge-sources";
import { firefliesLink, proposalHeadline, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { ReviewBatch, type ReviewProposal } from "./ReviewBatch";

// Org brain, phase 2: "ממתין לאישור" (claude/org-brain-spec-2026-10-12.md,
// 5.2; decision 1). Every proposal Claude sends lands here, one card per
// meeting or document, and nothing reaches a client file until a person
// approves it here. The goal is a normal batch in under five minutes.

export const metadata = { robots: { index: false, follow: false } };

function day(d: Date | null): string | null {
  return d ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d) : null;
}

export default async function KnowledgeReviewPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const { clientId } = await props.searchParams;
  const user = await requireUser();
  const batches = await listOpenBatches(user, { clientId });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-appNavy">ממתין לאישור</h1>
        <p className="mt-1 text-sm text-appNavy/60">
          מה ש-Claude הציע לתיקי הלקוחות. שום דבר לא נכנס לתיק לפני שמישהו מאשר אותו כאן.{" "}
          <Link href="/app/extraction-guide" className="text-gold-dim hover:underline">
            הנחיות החילוץ
          </Link>
          {clientId && (
            <>
              {" "}
              <Link href="/app/knowledge" className="text-gold-dim hover:underline">
                לכל הלקוחות
              </Link>
            </>
          )}
        </p>
      </div>

      {batches.length === 0 ? (
        <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">אין הצעות שממתינות לאישור.</div>
      ) : (
        batches.map((b) => {
          const fireflies =
            b.source && Array.isArray(b.source.externalRefs)
              ? ((b.source.externalRefs as { system?: string; id?: string }[]).find((r) => r?.system === "FIREFLIES")?.id ?? null)
              : null;
          const proposals: ReviewProposal[] = b.proposals.map((p) => {
            const payload = p.payload as Record<string, unknown>;
            const at = readSourceRefs(payload.sources)[0]?.at ?? null;
            return {
              id: p.id,
              target: p.target as ProposalTargetLike,
              action: p.action,
              state: p.state,
              headline: proposalHeadline(p.target as ProposalTargetLike, payload),
              payload,
              sources: readSourceRefs(payload.sources).map(formatSourceRef),
              reason: p.reason,
              quote: p.quote,
              flags: (Array.isArray(p.flags) ? p.flags : []) as { code: string; message: string }[],
              link: fireflies ? firefliesLink(fireflies, at) : null,
              existing: p.existing ? { body: p.existing.body } : null,
              rejectReason: p.rejectReason,
              hiddenFor: p.hiddenFor,
            };
          });
          return (
            <ReviewBatch
              key={b.id}
              clientId={b.client.id}
              clientName={b.client.name}
              sourceLabel={b.source ? `${b.source.code} ${b.source.title}` : "בלי מקור"}
              sourceDetails={[b.source ? SOURCE_KIND_LABELS[b.source.kind] : null, b.source ? day(b.source.occurredAt) : null, b.source?.restriction === "TOPICS_ONLY" ? "נושאים בלבד" : null, b.createdByName ? `נשלח על ידי ${b.createdByName}` : null]
                .filter(Boolean)
                .join(" · ")}
              note={b.note}
              droppedCount={Array.isArray(b.dropped) ? b.dropped.length : 0}
              proposals={proposals}
            />
          );
        })
      )}
    </div>
  );
}
