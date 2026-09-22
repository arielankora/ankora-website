"use client";
import { useFormState, useFormStatus } from "react-dom";
import { respondToDecisionAction } from "./actions";
import { formatMinor } from "@/lib/money";

// Portal phase 2. One decision, as a card.
//
// The shape is fixed on purpose: the question, why it came up, the
// options with their prices, our recommendation marked as ours, and one
// button per option. A client should be able to answer without reading a
// thread, and should never have to guess which option we would pick -
// withholding that is not neutrality, it is making them do our work.

type Option = { id: string; label: string; detail: string | null; amountMinor: number | null; recommended: boolean };

function SubmitOption({ option, canAnswer }: { option: Option; canAnswer: boolean }) {
  const { pending } = useFormStatus();
  const price = formatMinor(option.amountMinor);

  return (
    <button
      type="submit"
      disabled={pending || !canAnswer}
      className={`w-full rounded-[14px] border px-4 py-3 text-right transition-colors disabled:opacity-50 ${
        option.recommended ? "border-gold/50 bg-gold/10 hover:border-gold" : "border-lineDark bg-white hover:border-gold"
      }`}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-appNavy">
          {pending ? "נשלח..." : option.label}
          {option.recommended && !pending && <span className="mr-2 text-[11px] text-gold-dim">ההמלצה שלנו</span>}
        </span>
        {price && (
          <span dir="ltr" className="font-jbmono text-[12.5px] text-appNavy/60">
            {price}
          </span>
        )}
      </span>
      {option.detail && <span className="mt-1 block text-[12px] text-appNavy/55">{option.detail}</span>}
    </button>
  );
}

/// One option, one form.
///
/// The obvious build - a single form and a submit button per option
/// carrying `name="optionId"` - loses the answer: React's form-state
/// binding does not carry the submitter's own name/value into the action,
/// so every click arrived with no option and the decision stayed open.
/// Caught by the browser test for this screen, which is exactly the class
/// of bug a rendering assertion would have missed. A form per option
/// keeps the one-click gesture and puts the choice in a hidden field,
/// where nothing has to infer it.
function OptionForm({ decisionId, option, canAnswer }: { decisionId: string; option: Option; canAnswer: boolean }) {
  const [state, formAction] = useFormState(respondToDecisionAction, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="decisionId" value={decisionId} />
      <input type="hidden" name="optionId" value={option.id} />
      <SubmitOption option={option} canAnswer={canAnswer} />
      {state?.error && (
        <p className="mt-2 rounded-[10px] border border-error/30 bg-error-soft px-3 py-2 text-xs text-error">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function DecisionCard({
  decision,
  canAnswer,
  whatsappHref,
}: {
  decision: {
    id: string;
    question: string;
    background: string | null;
    amountMinor: number | null;
    ceilingMinor: number | null;
    aboveCeiling: boolean;
    dueAt: string | null;
    taskTitle: string | null;
    options: Option[];
  };
  /// False for a Client Viewer and inside a staff preview. The card still
  /// renders in full - seeing what is pending is not the same as being
  /// able to answer it, and hiding the question from a viewer would just
  /// send them back to WhatsApp to ask what it said.
  canAnswer: boolean;
  whatsappHref: string | null;
}) {
  return (
    <div className="rounded-2xl border border-gold/40 bg-[#FBF7F0] p-5">
      {decision.taskTitle && <p className="text-[11.5px] text-appNavy/50">{decision.taskTitle}</p>}
      <p className="mt-1 text-[15px] font-medium text-appNavy">{decision.question}</p>
      {decision.background && <p className="mt-1.5 text-[13px] leading-relaxed text-appNavy/65">{decision.background}</p>}

      {decision.aboveCeiling && (
        // The service agreement asks for the client's approval in writing
        // above the ceiling they set. Saying so on the card is what turns
        // a required signature into an obvious one.
        <p className="mt-3 rounded-[10px] border border-gold/40 bg-white px-3 py-2 text-[12px] text-appNavy/70">
          הסכום גבוה מהתקרה שסוכמה איתך ({formatMinor(decision.ceilingMinor)}), ולכן ההחלטה הזו שלך.
        </p>
      )}

      <div className="mt-4 space-y-2.5">
        {decision.options.map((o) => (
          <OptionForm key={o.id} decisionId={decision.id} option={o} canAnswer={canAnswer} />
        ))}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-appNavy/50">
        <span>
          {decision.dueAt
            ? `נשמח לתשובה עד ${new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(new Date(decision.dueAt))}`
            : "אין תאריך יעד להחלטה הזו"}
        </span>
        {/* Not a text box. Someone who wants to explain would rather talk,
            and the line they already use is one tap away. */}
        {whatsappHref ? (
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="text-gold-dim hover:underline">
            לדבר על זה
          </a>
        ) : (
          <span className="text-appNavy/35">לדבר על זה: זמין בקרוב</span>
        )}
      </div>

      {!canAnswer && (
        <p className="mt-2.5 text-[11.5px] text-appNavy/50">
          רק מנהל הלקוח יכול לאשר. אפשר להעביר את זה אליו, או לדבר איתנו.
        </p>
      )}
    </div>
  );
}
