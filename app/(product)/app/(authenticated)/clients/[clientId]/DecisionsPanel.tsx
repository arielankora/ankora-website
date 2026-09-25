"use client";
import { useState } from "react";
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
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
    >
      {/* Not "שליחה ללקוח". Since 25.9.2026 creating a decision sends
          nothing: it puts the question in the client's portal and hands
          the person a written message to send themselves. A button that
          says "שליחה" when nothing is sent is the screen lying to the
          person who pressed it. */}
      {pending ? "נוצרת..." : "יצירת ההחלטה"}
    </button>
  );
}

function OptionFields({ index, required }: { index: number; required: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-lineDark bg-white p-3 sm:grid-cols-[1fr_120px_auto]">
      <input
        name={`optionLabel${index}`}
        required={required}
        placeholder={required ? `אפשרות ${index + 1} (חובה)` : `אפשרות ${index + 1}`}
        className="rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
      />
      <input
        name={`optionAmount${index}`}
        dir="ltr"
        inputMode="decimal"
        placeholder="₪"
        className="rounded-lg border border-lineDark bg-white px-3 py-2 text-end text-sm text-appNavy outline-none focus:border-gold"
      />
      <label className="flex items-center gap-2 px-1 text-xs text-appNavy/70">
        <input type="radio" name="recommended" value={String(index)} className="h-4 w-4 accent-gold" />
        מומלץ
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
  const [state, formAction] = useFormState(createDecisionAction, {});
  const [open, setOpen] = useState(false);

  async function cancel(id: string, question: string) {
    const result = await cancelDecisionAction({ decisionId: id });
    if (!result.ok) {
      showToast({ tone: "error", title: "הביטול נכשל", description: result.error });
      return;
    }
    showToast({ tone: "info", title: "ההחלטה בוטלה", description: question });
  }

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-appNavy">החלטות ({decisions.filter((d) => d.status === "OPEN").length} פתוחות)</h2>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-gold-dim hover:underline">
          {open ? "סגירה" : "+ החלטה חדשה"}
        </button>
      </div>

      <p className="mt-1.5 text-[12px] text-appNavy/50">
        {ceilingMinor !== null
          ? `תקרת האישור של הלקוח: ${formatMinor(ceilingMinor)}. מעליה ההחלטה מוצגת ככזו שדורשת את אישורו.`
          : "לא הוגדרה תקרת אישור ללקוח הזה, ולכן כל החלטה עם סכום תוצג כדורשת אישור."}
      </p>

      {open && (
        <form action={formAction} className="mt-4 space-y-3 rounded-lg border border-lineDark bg-cream-dim/40 p-4">
          <input type="hidden" name="clientId" value={clientId} />
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">מה צריך להחליט *</span>
            <input
              name="question"
              required
              placeholder="באיזה מועד לקבוע את ביקור הטכנאי?"
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">רקע קצר</span>
            <textarea
              name="background"
              rows={2}
              placeholder="עד שלושה משפטים. מה הביא לצומת הזו."
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
            />
          </label>

          <div className="space-y-2.5">
            <OptionFields index={0} required />
            <OptionFields index={1} required />
            <OptionFields index={2} required={false} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-appNavy/60">סכום כולל (₪)</span>
              <input
                name="amount"
                dir="ltr"
                inputMode="decimal"
                placeholder="ריק אם ההחלטה אינה כספית"
                className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-end text-sm text-appNavy outline-none focus:border-gold"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-appNavy/60">נשמח לתשובה עד</span>
              <input
                name="dueAt"
                type="date"
                className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
              />
            </label>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.ok && (
            <p className="text-sm text-emerald-700">
              ההחלטה מחכה ללקוח בפורטל. הוא לא יודע על זה עדיין.
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
                buttonLabel="להודיע ללקוח"
                preselectKind="decision_waiting"
                {...composer}
              />
            )}
          </div>
        </form>
      )}

      {decisions.length === 0 ? (
        <p className="mt-3 text-sm text-appNavy/50">עוד לא נפתחו החלטות ללקוח הזה.</p>
      ) : (
        <ul className="mt-4 divide-y divide-lineDark/60">
          {decisions.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
              <span className="text-sm text-appNavy">{d.question}</span>
              <span className="flex items-center gap-2.5 text-[11.5px] text-appNavy/50">
                {formatMinor(d.amountMinor) && <span dir="ltr" className="font-jbmono">{formatMinor(d.amountMinor)}</span>}
                {d.status === "ANSWERED" && d.answer && (
                  <span className="text-success">נבחר: {d.answer.optionLabel}</span>
                )}
                {d.status === "CANCELLED" && <span>בוטלה</span>}
                {d.status === "OPEN" && (
                  <>
                    <span className="text-warning">ממתינה ללקוח</span>
                    <button type="button" onClick={() => cancel(d.id, d.question)} className="hover:text-error">
                      ביטול
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
