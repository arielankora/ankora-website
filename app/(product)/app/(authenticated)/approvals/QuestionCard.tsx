"use client";
import { useState, useTransition } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { useActionForm } from "@/components/app/useActionForm";
import { confirmSourceWithClientAction } from "../clients/source-actions";
import { createQuestionsTaskAction, markQuestionsAskedAction } from "./actions";

// One client's questions (lib/client-questions.ts): the list, and the
// message to send, drafted, to edit and copy or to hand on as a task.
// Nothing is sent from here: the person sends it, and marks it asked.

export type CardView = {
  clientId: string;
  clientName: string;
  contactName: string | null;
  ownerName: string | null;
  title: string;
  draft: string;
  items: { id: string; what: string; title: string; toResolve: string | null; isQuestion: boolean; internal: boolean; href: string; askedAt: string | null }[];
  lowered: { code: string; title: string; count: number }[];
};

const day = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });

export function QuestionCardView({ card, manager }: { card: CardView; manager: boolean }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(card.draft);
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const toAsk = card.items.filter((i) => !i.askedAt && !i.internal);
  const ids = toAsk.map((i) => i.id);

  const copy = () =>
    start(async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        showToast({ tone: "error", title: "ההעתקה נכשלה", description: "אפשר לסמן את הטקסט ולהעתיק ידנית." });
        return;
      }
      const r = await markQuestionsAskedAction(card.clientId, ids);
      if (r.error) showToast({ tone: "error", title: "הסימון נכשל", description: r.error });
      else {
        setSent("הועתק וסומן שנשאל");
        showToast({ tone: "success", title: "ההודעה הועתקה", description: "השאלות סומנו כנשאלו היום." });
      }
    });

  const toTask = () =>
    start(async () => {
      const r = await createQuestionsTaskAction(card.clientId, ids, text, card.contactName);
      if (r.error) showToast({ tone: "error", title: "המשימה לא נוצרה", description: r.error });
      else {
        setSent("נפתחה משימה לשליחה");
        showToast({ tone: "success", title: "נפתחה משימה לשליחה", description: "ההודעה בתוך המשימה." });
      }
    });

  return (
    <section className="rounded-2xl border border-app-border bg-white p-5" data-testid="question-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-app-text-primary">
            {card.clientName}: {card.title}
          </h3>
          {card.ownerName && <p className="mt-0.5 text-[11.5px] text-app-text-tertiary">אחראי: {card.ownerName}</p>}
        </div>
        {sent ? (
          <span className="text-[12.5px] text-app-text-tertiary">{sent}</span>
        ) : toAsk.length > 0 ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-full bg-app-surface-nav px-3.5 py-1.5 text-[12.5px] font-medium text-cream" data-testid="question-draft-toggle">
            {open ? "הסתרת ההודעה" : "ניסוח הודעה"}
          </button>
        ) : (
          <span className="text-[12.5px] text-app-text-tertiary">הכול נשאל, מחכים לתשובה</span>
        )}
      </div>

      {open && !sent && (
        <div className="mt-3 space-y-2" data-testid="question-draft">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, 6 + toAsk.length)} aria-label="ההודעה ללקוח" className="w-full rounded-lg border border-app-border bg-white px-3 py-2 text-[13px] leading-relaxed text-app-text-primary" />
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            <button type="button" disabled={pending || !text.trim()} onClick={copy} className="rounded-full bg-app-surface-nav px-3.5 py-1.5 font-medium text-cream disabled:opacity-40">
              {pending ? "רגע..." : "העתקה וסימון שנשאל"}
            </button>
            <button type="button" disabled={pending || !text.trim()} onClick={toTask} className="font-medium text-app-text-accent hover:underline disabled:opacity-40">
              משימה לשליחה
            </button>
            <span className="text-app-text-tertiary">לא נשלח כלום מכאן. שולחים בערוץ של הלקוח.</span>
          </div>
        </div>
      )}

      <ol className="mt-3 space-y-1.5">
        {card.items.map((i, n) => (
          <li key={i.id} className="text-[12.5px] leading-relaxed" data-testid="question-item">
            <span className="text-app-text-tertiary">{n + 1}. </span>
            <a href={i.href} className="text-app-text-primary hover:text-app-text-accent hover:underline">
              {i.title}
            </a>
            <span className="text-app-text-tertiary">
              {" · "}
              {i.what}
              {i.toResolve && !i.isQuestion ? ` · ${i.toResolve}` : ""}
              {i.internal ? " · פנימי, לא נכנס להודעה" : ""}
              {i.askedAt ? ` · נשאל ב-${day(i.askedAt)}` : ""}
            </span>
          </li>
        ))}
      </ol>

      {manager && card.lowered.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg bg-app-surface-sunken px-3 py-2.5">
          {card.lowered.map((l) => (
            <ConfirmSource key={l.code} clientId={card.clientId} source={l} />
          ))}
        </div>
      )}
    </section>
  );
}

/// "אושר מול הלקוח": the items uncertain only because Ankora wrote the
/// source, confirmed together once the client said they are right.
function ConfirmSource({ clientId, source }: { clientId: string; source: { code: string; title: string; count: number } }) {
  const { showToast } = useToast();
  const [done, setDone] = useState(false);
  const { onSubmit, pending, error } = useActionForm(confirmSourceWithClientAction, () => {
    setDone(true);
    showToast({ tone: "success", title: "אושר מול הלקוח", description: `${source.code} ${source.title}` });
  });
  if (done) return <p className="text-[12.5px] text-app-text-tertiary">{source.code}: אושר מול הלקוח.</p>;
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="confirm-source">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="code" value={source.code} />
      <span className="text-app-text-secondary">
        {source.count === 1 ? "פריט אחד" : `${source.count} פריטים`} מ-{source.code} ({source.title}) לא ודאיים רק כי אנקורה כתבה את המקור. אם הלקוח אישר:
      </span>
      <input name="note" required placeholder="איך זה אושר, בשורה אחת" aria-label="איך זה אושר" className="min-w-[12rem] flex-1 rounded-lg border border-app-border bg-white px-2.5 py-1 text-[12.5px]" />
      <button type="submit" disabled={pending} className="rounded-full border border-app-border px-3 py-1 font-medium text-app-text-primary disabled:opacity-40">
        {pending ? "שומר..." : "אושר מול הלקוח"}
      </button>
      {error && <span className="text-app-error">{error}</span>}
    </form>
  );
}
