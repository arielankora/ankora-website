import "server-only";
import { prisma } from "@/lib/prisma";
import { auditReadiness, staleReasons, type ReadinessItem, type StaleReason } from "@/lib/audit-readiness";
import { auditPrepPrompt } from "@/lib/stranger-test";
import { readApprovalEvidence } from "@/lib/step-approval";

// The procedure document's tab (14.11.2026, processes redesign, stage 4,
// "Document.dc.html"): the facts behind "לעדכן" (every client) and the
// readiness for an audit (a client with audit requirements, spec 4.7).

export type DocumentTab = {
  audit: boolean;
  /// The approved version: its number, when and by whom, and in which
  /// languages it can be downloaded.
  approved: { version: number; approvedAt: string | null; approvedBy: string | null; english: boolean } | null;
  stale: StaleReason[];
  readiness: { items: ReadinessItem[]; missing: number } | null;
  /// "להכין לביקורת": the prompt, or null for a client marked "בלי AI".
  prepPrompt: string | null;
};

type ShownProcess = {
  id: string;
  code: string;
  title: string;
  scope?: string | null;
  controlRefs?: string[];
  classification?: string | null;
  current: { steps: { evidence?: string | null; verification?: string | null }[] } | null;
  docMissing?: { field: string; label: string }[];
  approverLeft?: { step: number; name: string }[];
  stranger?: { open: unknown[] } | null;
};

export async function documentTabOf(
  p: ShownProcess,
  ctx: { clientId: string; clientName: string; audit: boolean; aiExcluded: boolean; rules: { title: string; updatedAt: Date }[]; endedAt: Map<string, string> }
): Promise<DocumentTab> {
  const [approved, lastStart, runs] = await Promise.all([
    prisma.processVersion.findFirst({
      where: { processId: p.id, status: "APPROVED" },
      select: { version: true, approvedAt: true, approvedById: true, translationEnApprovedAt: true, translationEn: true },
    }),
    // A rhythm saved in the editor, as its audit says. Not ProcessStart's
    // updatedAt: the stage 1 backfill wrote every row on 13.11.2026, and
    // each approved procedure would read as out of date.
    prisma.auditEvent.findFirst({ where: { entityId: p.id, action: "process.rhythm" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ctx.audit
      ? prisma.task.findMany({
          where: { processId: p.id, parentId: null, deletedAt: null, status: "DONE" },
          select: { subtasks: { where: { deletedAt: null }, select: { evidenceLink: true, approvalEvidence: true } } },
          take: 200,
        })
      : Promise.resolve([]),
  ]);
  const approver = approved?.approvedById ? await prisma.user.findUnique({ where: { id: approved.approvedById }, select: { name: true } }) : null;
  const stale = staleReasons({
    approvedAt: approved?.approvedAt ?? null,
    approverLeft: (p.approverLeft ?? []).map((l) => ({ ...l, at: ctx.endedAt.get(l.name) ?? null })),
    rhythmChangedAt: lastStart?.createdAt ?? null,
    rules: ctx.rules,
  });
  const readiness = ctx.audit
    ? auditReadiness({
        scope: p.scope ?? null,
        controlRefs: p.controlRefs ?? [],
        classification: p.classification ?? null,
        steps: p.current?.steps ?? [],
        docMissing: p.docMissing ?? [],
        translation: approved?.translationEnApprovedAt ? "approved" : approved?.translationEn ? "draft" : "none",
        // Spec 4.5: each step of a closed run, and those with a link to
        // their evidence (the link itself, or the client approval's link).
        runs: (() => {
          const steps = runs.flatMap((r) => r.subtasks);
          return { closed: steps.length, withEvidence: steps.filter((s) => !!s.evidenceLink || !!readApprovalEvidence(s.approvalEvidence)?.link).length };
        })(),
        strangerOpen: p.stranger?.open.length ?? 0,
      })
    : null;
  return {
    audit: ctx.audit,
    approved: approved
      ? { version: approved.version, approvedAt: approved.approvedAt?.toISOString() ?? null, approvedBy: approver?.name ?? null, english: !!approved.translationEnApprovedAt }
      : null,
    stale,
    readiness,
    prepPrompt: ctx.audit && !ctx.aiExcluded ? auditPrepPrompt(ctx.clientName, p.code, p.title) : null,
  };
}
