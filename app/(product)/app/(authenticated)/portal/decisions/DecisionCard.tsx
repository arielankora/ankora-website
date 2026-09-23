"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { respondToDecisionAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { formatMinor } from "@/lib/money";

// Portal phase 2. One decision, as a card.
//
// The shape is fixed on purpose: the question, why it came up, the
// options with their prices, our recommendation marked as ours, and one
// button per option. A client should be able to answer without reading a
// thread, and should never have to guess which option we would pick -
// withholding that is not neutrality, it is making them do our work.

type Option = { id: string; label: string; detail: string | null; amountMinor: number | null; recommended: boolean };

function SubmitOption({
  option,
  canAnswer,
  pending,
  locked,
}: {
  option: Option;
  canAnswer: boolean;
  pending: boolean;
  /// Another option on this card has already been answered. The card is
  /// still on screen because the screen behind it has not finished
  /// refreshing, and a second answer in that window would be a person
  /// changing a decision they did not mean to reopen.
  locked: boolean;
}) {
  const price = formatMinor(option.amountMinor);

  return (
    <button
      type="submit"
      disabled={pending || locked || !canAnswer}
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
///
/// Submitted through useActionForm rather than `<form action>`: the
/// button reports what the server said about this answer, and not how
/// long the two revalidated screens take to redraw. This is the client's
/// only write in the whole product, and "נשלח..." that never ends is the
/// worst place in Ankora to leave someone standing.
function OptionForm({
  decisionId,
  option,
  canAnswer,
  locked,
  onAnswered,
}: {
  decisionId: string;
  option: Option;
  canAnswer: boolean;
  locked: boolean;
  onAnswered: () => void;
}) {
  const { onSubmit, pending, error } = useActionForm(respondToDecisionAction, onAnswered);

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="decisionId" value={decisionId} />
      <input type="hidden" name="optionId" value={option.id} />
      <SubmitOption option={option} canAnswer={canAnswer} pending={pending} locked={locked} />
      {error && (
        <p className="mt-2 rounded-[10px] border border-error/30 bg-error-soft px-3 py-2 text-xs text-error">
          {error}
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
  /// Answered, and the card is still here because the screens behind it
  /// are still refreshing. Held on the card rather than inside one option
  /// so that answering any option closes all of them.
  const [answered, setAnswered] = useState(false);
  const router = useRouter();

  /// The answer changes the URL, and that is the point.
  ///
  /// This screen is the one write in the product made by somebody who is
  /// not us: a client approving spending above the ceiling they agreed.
  /// Twice now it has been caught leaving them looking at the same
  /// question after their approval was already recorded, because the
  /// refresh that was supposed to redraw the screen did not arrive. A
  /// refresh is a request; a navigation is not. Changing the query string
  /// means the router cannot reuse what it already has, so the server
  /// renders this screen again and the record is there.
  ///
  /// It also moves the confirmation somewhere it survives. "התשובה
  /// נקלטה" lived in this component's own state, which the redraw
  /// destroys - so the reassurance flickered out at the exact moment the
  /// page finally caught up.
  function onAnswered() {
    setAnswered(true);
    router.replace(`/app/portal/decisions?answered=${decision.id}`, { scroll: false });
  }

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
          <OptionForm
            key={o.id}
            decisionId={decision.id}
            option={o}
            canAnswer={canAnswer}
            locked={answered}
            onAnswered={onAnswered}
          />
        ))}
      </div>

      {answered && <p className="mt-2.5 text-[12px] text-appNavy/60">התשובה נקלטה. תודה.</p>}

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
