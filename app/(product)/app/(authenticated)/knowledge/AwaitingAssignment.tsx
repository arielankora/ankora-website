"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import type { ProposalTargetLike } from "@/lib/knowledge-proposals";
import { assignBatchAction, discardAwaitingAction } from "./actions";
import { useSourceDetailsLine, type SourceDetails } from "./ReviewBatch";

// "ממתין לשיוך" (claude/org-brain-spec-2026-10-12.md, 5.1, step 3): a
// meeting Claude could not tell whose it was. What it thinks and why, what
// the meeting would add, and one choice: which client. Once chosen, the
// items wait as an ordinary batch below, for the usual review.

export type AwaitingBatch = {
  id: string;
  sourceLabel: string;
  sourceDetails: SourceDetails;
  note: string | null;
  reason: string | null;
  proposedClientId: string;
  /// `removed`: the client is gone, and `name` is not its name.
  candidates: { id: string; name: string; removed?: boolean }[];
  /// The kind and the line of each item; a null line is a sensitive item.
  items: { target: ProposalTargetLike; headline: string | null }[];
  droppedCount: number;
};

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

function DiscardForm({ batchId }: { batchId: string }) {
  const t = useTranslations("knowledge.awaiting");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(discardAwaitingAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="batchId" value={batchId} />
      <p className="text-sm text-app-text-secondary">{t("discardIntro")}</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("discardWhy")}</span>
        <input name="why" required placeholder={t("discardPlaceholder")} className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("removing") : t("remove")}
      </button>
    </form>
  );
}

export function AwaitingAssignmentCard({ batch }: { batch: AwaitingBatch }) {
  const t = useTranslations("knowledge.awaiting");
  const tk = useTranslations("knowledge");
  const details = useSourceDetailsLine(batch.sourceDetails);
  const { showToast } = useToast();
  const [clientId, setClientId] = useState(batch.proposedClientId);
  const nameOf = (c: { name: string; removed?: boolean } | undefined, fallback: string) => (!c ? fallback : c.removed ? t("removedClient") : c.name);
  const chosen = batch.candidates.find((c) => c.id === clientId);
  const { onSubmit, pending, error } = useActionForm(assignBatchAction, () =>
    showToast({ tone: "info", title: t("assigned", { name: nameOf(chosen, t("clientFallback")) }), description: t("assignedDescription") })
  );
  const proposed = batch.candidates.find((c) => c.id === batch.proposedClientId);
  return (
    <section className="rounded-2xl border border-app-warning/40 bg-white p-6" data-testid="awaiting-assignment">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-app-warning">{t("label")}</p>
          <h2 className="text-sm font-medium text-app-text-primary" dir="auto">
            {batch.sourceLabel}
          </h2>
          {details && <p className="text-xs text-app-text-secondary">{details}</p>}
        </div>
        <p className="text-xs text-app-text-secondary">{t("itemCount", { count: batch.items.length })}</p>
      </div>
      <p className="mt-3 text-sm text-app-text-primary">
        {t.rich(batch.reason ? "claudeThinksBecause" : "claudeThinks", {
          name: nameOf(proposed, t("removedClient")),
          reason: batch.reason ?? "",
          b: (chunks) => <span className="font-medium">{chunks}</span>,
        })}
      </p>
      {batch.note && (
        <p className="mt-1 text-xs text-app-text-secondary" dir="auto">
          {batch.note}
        </p>
      )}
      {batch.droppedCount > 0 && <p className="mt-1 text-xs text-app-warning">{t("dropped", { count: batch.droppedCount })}</p>}
      <ul className="mt-3 space-y-1 text-xs text-app-text-secondary">
        {batch.items.map((item, i) => (
          <li key={i} dir="auto">
            •{" "}
            {item.headline === null
              ? t("sensitiveItem", { kind: tk(`targets.${item.target}`) })
              : t("item", { kind: tk(`targets.${item.target}`), text: item.headline })}
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="batchId" value={batch.id} />
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">{t("whose")}</span>
          <select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT}>
            {batch.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {nameOf(c, "")}
                {c.id === batch.proposedClientId ? ` ${t("claudesProposal")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50">
          {pending ? t("assigning") : t("assignTo", { name: nameOf(chosen, "") })}
        </button>
        <Drawer triggerLabel={t("noneOfThem")} title={t("discardTitle")} variant="link">
          <DiscardForm batchId={batch.id} />
        </Drawer>
      </form>
      {clientId !== batch.proposedClientId && (
        <p className="mt-2 text-xs text-app-text-secondary">{t("otherClientNote")}</p>
      )}
      {error && <p className="mt-2 text-sm text-app-error">{error}</p>}
    </section>
  );
}
