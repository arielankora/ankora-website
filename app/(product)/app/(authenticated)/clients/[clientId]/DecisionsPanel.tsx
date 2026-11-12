"use client";
import { decisionAnchor } from "@/lib/approval-links";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFormState, useFormStatus } from "react-dom";
import { createDecisionAction, cancelDecisionAction } from "../actions";
import { useToast } from "@/components/app/toast/ToastProvider";
import { formatMinor } from "@/lib/money";
import { MessageClient, type ComposerProps } from "@/components/app/MessageClient";

// Portal phase 2, Ankora's side of a decision.
//
// The form is the shape of the card the client will see, in the same
// order, so whoever writes it is looking at what they are about to send
// rather than at a database form. Two options are required and three are
// the ceiling - see createDecision for why both ends are product rules.

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("clients.decisions");
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {/* Not "שליחה ללקוח". Since 25.9.2026 creating a decision sends
          nothing: it puts the question in the client's portal and hands
          the person a written message to send themselves. A button that
          says "שליחה" when nothing is sent is the screen lying to the
          person who pressed it. */}
      {pending ? t("creating") : t("create")}
    </button>
  );
}

function OptionFields({ index, required }: { index: number; required: boolean }) {
  const t = useTranslations("clients.decisions");
  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-app-border bg-white p-3 sm:grid-cols-[1fr_120px_auto]">
      <input
        name={`optionLabel${index}`}
        required={required}
        placeholder={required ? t("optionRequired", { n: index + 1 }) : t("option", { n: index + 1 })}
        className="rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
      />
      <input
        name={`optionAmount${index}`}
        dir="ltr"
        inputMode="decimal"
        placeholder="₪"
        className="rounded-lg border border-app-border-strong bg-white px-3 py-2 text-end text-sm text-app-text-primary outline-none focus:border-gold"
      />
      <label className="flex items-center gap-2 px-1 text-xs text-app-text-secondary">
        <input type="radio" name="recommended" value={String(index)} className="h-4 w-4 accent-gold" />
        {t("recommended")}
      </label>
    </div>
  );
}

export function DecisionsPanel({
  clientId,
  decisions,
  ceilingMinor,
  composer,
}: {
  clientId: string;
  decisions: {
    id: string;
    question: string;
    status: "OPEN" | "ANSWERED" | "CANCELLED";
    amountMinor: number | null;
    createdAt: string;
    answer: { optionLabel: string; respondedByName: string; respondedAt: string } | null;
  }[];
  ceilingMinor: number | null;
  /// The composer, ready. Null only when the client row vanished between
  /// the two reads, in which case the panel simply has no button.
  composer: ComposerProps | null;
}) {
  const { showToast } = useToast();
  const t = useTranslations("clients.decisions");
  const [state, formAction] = useFormState(createDecisionAction, {});
  const [open, setOpen] = useState(false);

  async function cancel(id: string, question: string) {
    const result = await cancelDecisionAction({ decisionId: id });
    if (!result.ok) {
      showToast({ tone: "error", title: t("cancelFailed"), description: result.error });
      return;
    }
    showToast({ tone: "info", title: t("cancelled"), description: question });
  }

  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">{t("title", { count: decisions.filter((d) => d.status === "OPEN").length })}</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-app-text-accent hover:underline">
          {open ? t("close") : t("new")}
        </button>
      </div>

      <p className="mt-1.5 text-[12px] text-app-text-tertiary">
        {ceilingMinor !== null
          ? t("ceiling", { amount: formatMinor(ceilingMinor) ?? "" })
          : t("noCeiling")}
      </p>

      {open && (
        <form action={formAction} className="mt-4 space-y-3 rounded-lg border border-app-border bg-cream-dim/40 p-4">
          <input type="hidden" name="clientId" value={clientId} />
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("question")}</span>
            <input
              name="question"
              required
              placeholder={t("questionPlaceholder")}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("background")}</span>
            <textarea
              name="background"
              rows={2}
              placeholder={t("backgroundPlaceholder")}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>

          <div className="space-y-2.5">
            <OptionFields index={0} required />
            <OptionFields index={1} required />
            <OptionFields index={2} required={false} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-app-text-secondary">{t("amount")}</span>
              <input
                name="amount"
                dir="ltr"
                inputMode="decimal"
                placeholder={t("amountPlaceholder")}
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-end text-sm text-app-text-primary outline-none focus:border-gold"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-app-text-secondary">{t("dueAt")}</span>
              <input
                name="dueAt"
                type="date"
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              />
            </label>
          </div>

          {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
          {state?.ok && (
            <p className="text-sm text-app-success">
              {t("created")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <SubmitButton />
            {/* The second half of the sentence above, as a button, and
                only once there is something to announce. Offered before
                the decision exists it would write to a client about a
                question nobody has asked yet. */}
            {state?.ok && composer && (
              <MessageClient
                clientId={clientId}
                buttonLabel={t("notify")}
                preselectKind="decision_waiting"
                {...composer}
              />
            )}
          </div>
        </form>
      )}

      {decisions.length === 0 ? (
        <p className="mt-3 text-sm text-app-text-tertiary">{t("empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {decisions.map((d) => (
            <li key={d.id} id={decisionAnchor(d.id)} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
              <span dir="auto" className="text-sm text-app-text-primary">{d.question}</span>
              <span className="flex items-center gap-2.5 text-[11.5px] text-app-text-tertiary">
                {formatMinor(d.amountMinor) && <span dir="ltr" className="font-jbmono">{formatMinor(d.amountMinor)}</span>}
                {d.status === "ANSWERED" && d.answer && (
                  <span className="text-app-success">{t("chosen", { option: d.answer.optionLabel })}</span>
                )}
                {d.status === "CANCELLED" && <span>{t("statusCancelled")}</span>}
                {d.status === "OPEN" && (
                  <>
                    <span className="text-app-warning">{t("waiting")}</span>
                    <button type="button" onClick={() => cancel(d.id, d.question)} className="hover:text-app-error">
                      {t("cancel")}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
