"use client";
import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { QuestionItemKind } from "@/lib/client-questions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { useActionForm } from "@/components/app/useActionForm";
import { confirmSourceWithClientAction } from "../source-actions";
import {
  askClientAboutAction,
  checkQuestionOurselvesAction,
  createQuestionsTaskAction,
  dismissQuestionAction,
  markQuestionsAskedAction,
  snoozeQuestionAction,
} from "../question-actions";

// "מה לברר עם הלקוח" on the client's page (1.11.2026,
// lib/client-questions.ts): the open questions and the uncertain items
// someone chose to ask about, one card per owner, the message to send
// drafted, and on each line a way out: not relevant, we check it, or later.
// Under the cards, the file's other uncertain items, each one a press away
// from the card. Nothing is sent from here.

type Item = { id: string; what: string; kind?: QuestionItemKind; title: string; toResolve: string | null; isQuestion: boolean; internal: boolean; href: string; askedAt: string | null };

export type CardView = {
  clientId: string;
  clientName: string;
  contactName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  title: string;
  draft: string;
  items: Item[];
  snoozed: { id: string; title: string; until: string }[];
  lowered: { code: string; title: string; count: number }[];
};

export type UncertainView = { id: string; what: string; kind?: QuestionItemKind; title: string; toResolve: string | null; href: string };

type QuestionsT = ReturnType<typeof useTranslations<"clients.questions">>;

/// A day and month, as the reader writes dates.
function useDay() {
  const format = useFormatter();
  return (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric" });
}

/// "פריט", "איש קשר"...: what kind of line, in the reader's language.
function whatOf(t: QuestionsT, item: { what: string; kind?: QuestionItemKind }): string {
  return item.kind ? t(`kinds.${item.kind}`) : item.what;
}

/// The card's title, "9 שאלות לאורן" (lib/client-questions.ts cardTitle
/// words the same for the server).
function cardTitleOf(t: QuestionsT, card: CardView): string {
  const count = card.items.filter((i) => !i.askedAt).length || card.items.length;
  const name = card.contactName?.trim().split(/\s+/)[0];
  return name ? t("cardTitleTo", { count, name, latin: /^[A-Za-z]/.test(name) ? "yes" : "no" }) : t("cardTitleClient", { count });
}

export function ClientQuestions({ clientId, cards, uncertain, manager }: { clientId: string; cards: CardView[]; uncertain: UncertainView[]; manager: boolean }) {
  const t = useTranslations("clients.questions");
  if (cards.length === 0 && uncertain.length === 0) return null;
  return (
    <section id="client-questions" className="space-y-3" data-testid="client-questions">
      <div>
        <h2 className="text-sm font-medium text-app-text-primary">{t("heading")}</h2>
        <p className="mt-0.5 text-xs text-app-text-secondary">{t("intro")}</p>
      </div>
      {cards.length === 0 ? (
        <p className="rounded-2xl border border-app-border bg-white px-5 py-4 text-[12.5px] text-app-text-tertiary">{t("empty")}</p>
      ) : (
        cards.map((c) => <QuestionCardView key={c.ownerId ?? "none"} card={c} manager={manager} />)
      )}
      {uncertain.length > 0 && <UncertainList clientId={clientId} items={uncertain} />}
    </section>
  );
}

function QuestionCardView({ card, manager }: { card: CardView; manager: boolean }) {
  const { showToast } = useToast();
  const t = useTranslations("clients.questions");
  const day = useDay();
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
        showToast({ tone: "error", title: t("toast.copyFailed"), description: t("toast.copyFailedHint") });
        return;
      }
      const r = await markQuestionsAskedAction(card.clientId, ids);
      if (r.error) showToast({ tone: "error", title: t("toast.markFailed"), description: r.error });
      else {
        setSent(t("copiedAndMarked"));
        showToast({ tone: "success", title: t("toast.copied"), description: t("toast.copiedHint") });
      }
    });

  const toTask = () =>
    start(async () => {
      const r = await createQuestionsTaskAction(card.clientId, ids, text, card.contactName);
      if (r.error) showToast({ tone: "error", title: t("toast.taskFailed"), description: r.error });
      else {
        setSent(t("sendTaskOpened"));
        showToast({ tone: "success", title: t("sendTaskOpened"), description: t("toast.sendTaskHint") });
      }
    });

  return (
    <div className="rounded-2xl border border-app-border bg-white p-5" data-testid="question-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-app-text-primary">{card.items.length > 0 ? cardTitleOf(t, card) : t("noOpenQuestions")}</h3>
          {card.ownerName && <p className="mt-0.5 text-[11.5px] text-app-text-tertiary">{t("owner", { name: card.ownerName })}</p>}
        </div>
        {sent ? (
          <span className="text-[12.5px] text-app-text-tertiary">{sent}</span>
        ) : toAsk.length > 0 ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-full bg-app-surface-nav px-3.5 py-1.5 text-[12.5px] font-medium text-cream" data-testid="question-draft-toggle">
            {open ? t("hideDraft") : t("showDraft")}
          </button>
        ) : card.items.length > 0 ? (
          <span className="text-[12.5px] text-app-text-tertiary">{t("allAsked")}</span>
        ) : null}
      </div>

      {open && !sent && (
        <div className="mt-3 space-y-2" data-testid="question-draft">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, 6 + toAsk.length)} aria-label={t("draftLabel")} dir="auto" className="w-full rounded-lg border border-app-border bg-white px-3 py-2 text-[13px] leading-relaxed text-app-text-primary" />
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            <button type="button" disabled={pending || !text.trim()} onClick={copy} className="rounded-full bg-app-surface-nav px-3.5 py-1.5 font-medium text-cream disabled:opacity-40">
              {pending ? t("wait") : t("copyAndMark")}
            </button>
            <button type="button" disabled={pending || !text.trim()} onClick={toTask} className="font-medium text-app-text-accent hover:underline disabled:opacity-40">
              {t("sendTask")}
            </button>
            <span className="text-app-text-tertiary">{t("nothingSent")}</span>
          </div>
        </div>
      )}

      {card.items.length > 0 && (
        // Rows are divs with list roles, not <li>: the file's own panels
        // list the same items as <li>, and a row here must not stand in
        // for the item itself (what finds "the item's row" finds that one).
        <div role="list" className="mt-3 divide-y divide-app-border">
          {card.items.map((i, n) => (
            <QuestionLine key={i.id} clientId={card.clientId} item={i} n={n + 1} />
          ))}
        </div>
      )}

      {card.snoozed.length > 0 && (
        <p className="mt-3 text-[12px] text-app-text-tertiary" data-testid="question-snoozed">
          {t("snoozed")}{" "}
          {card.snoozed.map((s, n) => (
            <span key={s.id}>
              {n > 0 && ", "}
              {s.title.length > 60 ? `${s.title.slice(0, 59)}…` : s.title} {t("returnsOn", { date: day(s.until) })}
            </span>
          ))}
        </p>
      )}

      {manager && card.lowered.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg bg-app-surface-sunken px-3 py-2.5">
          {card.lowered.map((l) => (
            <ConfirmSource key={l.code} clientId={card.clientId} source={l} />
          ))}
        </div>
      )}
    </div>
  );
}

/// One line, and its three ways out. "לא רלוונטי" and "לדחות עד" open a
/// short field first: a reason, or a date.
function QuestionLine({ clientId, item, n }: { clientId: string; item: Item; n: number }) {
  const { showToast } = useToast();
  const t = useTranslations("clients.questions");
  const day = useDay();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"none" | "dismiss" | "snooze">("none");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const act = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) showToast({ tone: "error", title: t("toast.failed"), description: r.error });
      else {
        setDone(ok);
        setMode("none");
        showToast({ tone: "success", title: ok });
      }
    });

  return (
    <div role="listitem" className="py-2 text-[12.5px] leading-relaxed" data-testid="question-item">
      <div>
        <span className="text-app-text-tertiary">{n}. </span>
        <a href={item.href} className="text-app-text-primary hover:text-app-text-accent hover:underline" dir="auto">
          {item.title}
        </a>
        <span className="text-app-text-tertiary">
          {" · "}
          {whatOf(t, item)}
          {item.toResolve && !item.isQuestion ? ` · ${item.toResolve}` : ""}
          {item.internal ? ` · ${t("internal")}` : ""}
          {item.askedAt ? ` · ${t("askedOn", { date: day(item.askedAt) })}` : ""}
        </span>
      </div>
      {done ? (
        <p className="mt-1 text-[12px] text-app-text-tertiary">{done}</p>
      ) : mode === "dismiss" ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="question-dismiss">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("dismissPlaceholder")}
            aria-label={t("dismissLabel")}
            className="min-w-[12rem] flex-1 rounded-lg border border-app-border bg-white px-2.5 py-1 text-[12.5px]"
          />
          <button type="button" disabled={pending || !reason.trim()} onClick={() => act(() => dismissQuestionAction(clientId, item.id, reason), t("dismissed"))} className="rounded-full border border-app-border px-3 py-1 font-medium text-app-text-primary disabled:opacity-40">
            {pending ? t("saving") : t("close")}
          </button>
          <button type="button" onClick={() => setMode("none")} className="text-app-text-tertiary hover:text-app-text-primary">
            {t("cancel")}
          </button>
        </div>
      ) : mode === "snooze" ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="question-snooze">
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label={t("snoozeLabel")} className="rounded-lg border border-app-border bg-white px-2.5 py-1 text-[12.5px]" />
          <button type="button" disabled={pending || !until} onClick={() => act(() => snoozeQuestionAction(clientId, item.id, until), t("snoozedUntil", { date: day(`${until}T06:00:00Z`) }))} className="rounded-full border border-app-border px-3 py-1 font-medium text-app-text-primary disabled:opacity-40">
            {pending ? t("saving") : t("snooze")}
          </button>
          <button type="button" onClick={() => setMode("none")} className="text-app-text-tertiary hover:text-app-text-primary">
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px]" data-testid="question-actions">
          <button type="button" disabled={pending} onClick={() => setMode("dismiss")} className="text-app-text-secondary hover:text-app-text-primary">
            {t("notRelevant")}
          </button>
          <button type="button" disabled={pending} onClick={() => act(() => checkQuestionOurselvesAction(clientId, item.id), t("taskOpenedForYou"))} className="text-app-text-accent hover:underline">
            {t("checkOurselves")}
          </button>
          <button type="button" disabled={pending} onClick={() => setMode("snooze")} className="text-app-text-secondary hover:text-app-text-primary">
            {t("snoozeUntil")}
          </button>
        </div>
      )}
    </div>
  );
}

/// The other uncertain items in the file. They stay marked in the file
/// and counted in the control line; one press puts an item on the card.
function UncertainList({ clientId, items }: { clientId: string; items: UncertainView[] }) {
  const { showToast } = useToast();
  const t = useTranslations("clients.questions");
  const [pending, start] = useTransition();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const ask = (id: string) =>
    start(async () => {
      const r = await askClientAboutAction(clientId, [id]);
      if (r.error) showToast({ tone: "error", title: t("toast.notAdded"), description: r.error });
      else setAdded((s) => new Set(s).add(id));
    });
  return (
    <details className="rounded-2xl border border-app-border bg-white px-5 py-3" data-testid="uncertain-items">
      <summary className="cursor-pointer text-[12.5px] text-app-text-secondary">
        {t("uncertainSummary", { count: items.length })}
      </summary>
      <div role="list" className="mt-2 divide-y divide-app-border">
        {items.map((i) => (
          <div role="listitem" key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-[12.5px]" data-testid="uncertain-item">
            <span className="min-w-0">
              <a href={i.href} className="text-app-text-primary hover:text-app-text-accent hover:underline" dir="auto">
                {i.title}
              </a>
              <span className="text-app-text-tertiary">
                {" · "}
                {whatOf(t, i)}
                {i.toResolve ? ` · ${i.toResolve}` : ""}
              </span>
            </span>
            {added.has(i.id) ? (
              <span className="text-[12px] text-app-text-tertiary">{t("added")}</span>
            ) : (
              <button type="button" disabled={pending} onClick={() => ask(i.id)} className="text-[12px] font-medium text-app-text-accent hover:underline disabled:opacity-40">
                {t("askClient")}
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/// "אושר מול הלקוח": the items uncertain only because Ankora wrote the
/// source, confirmed together once the client said they are right.
function ConfirmSource({ clientId, source }: { clientId: string; source: { code: string; title: string; count: number } }) {
  const { showToast } = useToast();
  const t = useTranslations("clients.questions");
  const [done, setDone] = useState(false);
  const { onSubmit, pending, error } = useActionForm(confirmSourceWithClientAction, () => {
    setDone(true);
    showToast({ tone: "success", title: t("confirmedWithClient"), description: `${source.code} ${source.title}` });
  });
  if (done) return <p className="text-[12.5px] text-app-text-tertiary">{t("sourceConfirmed", { code: source.code })}</p>;
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="confirm-source">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="code" value={source.code} />
      <span className="text-app-text-secondary">
        {t("loweredLine", { count: source.count, code: source.code, title: source.title })}
      </span>
      <input name="note" required placeholder={t("confirmNotePlaceholder")} aria-label={t("confirmNoteLabel")} className="min-w-[12rem] flex-1 rounded-lg border border-app-border bg-white px-2.5 py-1 text-[12.5px]" />
      <button type="submit" disabled={pending} className="rounded-full border border-app-border px-3 py-1 font-medium text-app-text-primary disabled:opacity-40">
        {pending ? t("saving") : t("confirmedWithClient")}
      </button>
      {error && <span className="text-app-error">{error}</span>}
    </form>
  );
}
