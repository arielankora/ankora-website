"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { assignBatchAction, discardAwaitingAction } from "./actions";

// "ממתין לשיוך" (claude/org-brain-spec-2026-10-12.md, 5.1, step 3): a
// meeting Claude could not tell whose it was. What it thinks and why, what
// the meeting would add, and one choice: which client. Once chosen, the
// items wait as an ordinary batch below, for the usual review.

export type AwaitingBatch = {
  id: string;
  sourceLabel: string;
  sourceDetails: string;
  note: string | null;
  reason: string | null;
  proposedClientId: string;
  candidates: { id: string; name: string }[];
  items: string[];
  droppedCount: number;
};

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

function DiscardForm({ batchId }: { batchId: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(discardAwaitingAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="batchId" value={batchId} />
      <p className="text-sm text-app-text-secondary">השיחה והפריטים שלה יוסרו, ולא ייכנסו לאף תיק.</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">למה, בשורה אחת *</span>
        <input name="why" required placeholder="שיחה של הספק עם לקוח שלא שלנו" className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "מסיר..." : "הסרה"}
      </button>
    </form>
  );
}

export function AwaitingAssignmentCard({ batch }: { batch: AwaitingBatch }) {
  const { showToast } = useToast();
  const [clientId, setClientId] = useState(batch.proposedClientId);
  const chosen = batch.candidates.find((c) => c.id === clientId);
  const { onSubmit, pending, error } = useActionForm(assignBatchAction, () => showToast({ tone: "info", title: `שויך ל${chosen?.name ?? "לקוח"}`, description: "הפריטים ממתינים עכשיו לאישור, כמו כל אצווה." }));
  const proposed = batch.candidates.find((c) => c.id === batch.proposedClientId);
  return (
    <section className="rounded-2xl border border-app-warning/40 bg-white p-6" data-testid="awaiting-assignment">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-app-warning">ממתין לשיוך</p>
          <h2 className="text-sm font-medium text-app-text-primary">{batch.sourceLabel}</h2>
          {batch.sourceDetails && <p className="text-xs text-app-text-secondary">{batch.sourceDetails}</p>}
        </div>
        <p className="text-xs text-app-text-secondary">{batch.items.length === 1 ? "פריט אחד" : `${batch.items.length} פריטים`}</p>
      </div>
      <p className="mt-3 text-sm text-app-text-primary">
        Claude חושב שזו שיחה של <span className="font-medium">{proposed?.name ?? "לקוח שהוסר"}</span>
        {batch.reason ? `: ${batch.reason}` : "."}
      </p>
      {batch.note && <p className="mt-1 text-xs text-app-text-secondary">{batch.note}</p>}
      {batch.droppedCount > 0 && (
        <p className="mt-1 text-xs text-app-warning">{batch.droppedCount === 1 ? "פריט אחד לא נשמר" : `${batch.droppedCount} פריטים לא נשמרו`} (סוד או ציטוט ממקור מוגבל).</p>
      )}
      <ul className="mt-3 space-y-1 text-xs text-app-text-secondary">
        {batch.items.map((line, i) => (
          <li key={i}>• {line}</li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="batchId" value={batch.id} />
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">של מי השיחה</span>
          <select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT}>
            {batch.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.id === batch.proposedClientId ? " (ההצעה של Claude)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50">
          {pending ? "משייך..." : `שיוך ל${chosen?.name ?? ""}`}
        </button>
        <Drawer triggerLabel="לא של אף אחד מהם" title="הסרת שיחה שממתינה לשיוך" variant="link">
          <DiscardForm batchId={batch.id} />
        </Drawer>
      </form>
      {clientId !== batch.proposedClientId && (
        <p className="mt-2 text-xs text-app-text-secondary">ללקוח אחר מזה ש-Claude הציע: פריט שמשנה עובדה בתיק של הלקוח המוצע לא עובר, וקודי מקורות שלו לא נשמרים.</p>
      )}
      {error && <p className="mt-2 text-sm text-app-error">{error}</p>}
    </section>
  );
}
