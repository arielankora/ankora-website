"use client";
import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { recordClientMessageAction } from "@/app/(product)/app/(authenticated)/clients/message-actions";

// The button that writes to a client, and the person who presses send.
//
// Ariel, 25.9.2026: nothing goes out to a client automatically. What is
// wanted is this - a ready message, editable, everywhere there is a
// reason to write one. So this component takes a context and nothing
// else, and mounting it on a new screen is one line.
//
// Three ways out, and a person takes one of them:
//
//   - WhatsApp, which opens the conversation with the text already in
//     the box. The person presses send inside WhatsApp. No integration,
//     nothing scheduled, and it lands where this company's clients are.
//   - the clipboard, which always works.
//   - email, for clients who read email.
//
// **The client's own words about how to reach them are shown above the
// buttons**, not parsed into a default. The first version of this did
// parse them, and the sentence "וואטסאפ בלבד, לא מיילים" came out as
// email. See the comment in lib/app-domain/client-messages.ts.

export type MessageDraftChoice = { kind: string; label: string; emailSubject: string; body: string };

/// Everything about a client that the composer needs, as one object, so
/// that a screen mounting the button writes `{...composer}` and cannot
/// leave out the field whose whole job is to be remembered.
///
/// Built on the server by messageComposerProps. Declared here rather
/// than beside it because two panels take it as a prop, and a type they
/// each redeclare is a type that drifts.
export type ComposerProps = {
  clientName: string;
  preference: string | null;
  never: string | null;
  whatsappDigits: string | null;
  emails: string[];
  drafts: MessageDraftChoice[];
};

export function MessageClient({
  clientId,
  taskId,
  clientName,
  drafts,
  whatsappDigits,
  emails,
  preference,
  never,
  buttonLabel = "הודעה ללקוח",
  preselectKind,
}: {
  clientId: string;
  taskId?: string | null;
  clientName: string;
  drafts: MessageDraftChoice[];
  whatsappDigits: string | null;
  emails: string[];
  /// What the client said about how they want to be contacted, in their
  /// own words. Shown, never interpreted.
  preference: string | null;
  /// And what they said must never happen. The one field in this product
  /// whose entire purpose is to stop somebody doing the obvious thing.
  never: string | null;
  /// What the button says, where the screen already knows why somebody
  /// would press it. On a task it is "הודעה ללקוח", because the reason
  /// could be any of the six. Beside a decision that was just created it
  /// is "להודיע ללקוח", because there is exactly one reason.
  buttonLabel?: string;
  /// Skip the situation list and open on this draft. Only for a screen
  /// where the situation is not a question: a decision is waiting, and
  /// asking the person to pick "משהו מחכה להחלטה" out of six options is
  /// asking them to confirm what they just did.
  preselectKind?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<MessageDraftChoice | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function start(draft: MessageDraftChoice) {
    setChosen(draft);
    setText(draft.body);
    setError(null);
    setSent(null);
  }

  function begin() {
    const pre = preselectKind ? drafts.find((d) => d.kind === preselectKind) : null;
    if (pre) start(pre);
    setOpen(true);
  }

  function dismiss() {
    setOpen(false);
    setChosen(null);
    setSent(null);
    setError(null);
  }

  async function record(channel: "whatsapp" | "email" | "copied") {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    const result = await recordClientMessageAction({
      clientId,
      taskId: taskId ?? null,
      kind: chosen.kind,
      channel,
      subject: chosen.emailSubject,
      body: text,
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setSent(channel);
  }

  return (
    <>
      <button
        type="button"
        onClick={begin}
        className="inline-flex items-center gap-1.5 rounded-full border border-lineDark bg-white px-3 py-1.5 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold"
      >
        <MessageSquare size={14} strokeWidth={2} />
        {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`הודעה ל${clientName}`}>
          <button type="button" aria-label="סגירה" onClick={dismiss} className="absolute inset-0 bg-appNavy/30" />
          <div className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col border-s border-lineDark bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-lineDark px-5 py-4">
              <h2 className="text-base font-medium text-appNavy">הודעה ל{clientName}</h2>
              <button type="button" aria-label="סגירה" onClick={dismiss} className="text-appNavy/50 hover:text-appNavy">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {(preference || never) && (
                // Before anything else on the screen. A person about to
                // write has to see what this client said about being
                // written to, and `never` is the field that exists to
                // stop exactly this moment going wrong.
                <div className="rounded-xl border border-gold/40 bg-[#FBF7F0] p-3 text-[12.5px] text-appNavy/75">
                  {preference && <p>{preference}</p>}
                  {never && <p className={preference ? "mt-1" : ""}>לא: {never}</p>}
                </div>
              )}

              {!chosen ? (
                <div>
                  <p className="text-[12.5px] text-appNavy/60">מה קרה?</p>
                  <ul className="mt-2 space-y-1">
                    {drafts.map((d) => (
                      <li key={d.kind}>
                        <button
                          type="button"
                          onClick={() => start(d)}
                          className="w-full rounded-lg px-2 py-2 text-start text-[13.5px] text-appNavy transition-colors hover:bg-cream/60"
                        >
                          {d.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-label="נוסח ההודעה"
                    rows={12}
                    className="w-full rounded-xl border border-lineDark bg-white p-3 text-[13.5px] leading-relaxed text-appNavy outline-none focus:border-gold"
                  />
                  <p className="text-[11.5px] text-appNavy/50">
                    מה שבסוגריים מרובעים צריך להשלים לפני השליחה.
                  </p>

                  {sent ? (
                    <p className="rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-[12.5px] text-appNavy">
                      נרשם. ההודעה נשמרה על הלקוח{taskId ? " ועל המשימה" : ""}.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {whatsappDigits && (
                        <a
                          href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(text)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => record("whatsapp")}
                          className="rounded-full bg-gold-gradient px-4 py-2 text-[12.5px] font-medium text-navy"
                        >
                          פתיחה בוואטסאפ
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(text);
                          } catch {
                            // A blocked clipboard is not a reason to
                            // lose the record: the person can select the
                            // text themselves, and they still sent it.
                          }
                          await record("copied");
                        }}
                        className="rounded-full border border-lineDark px-4 py-2 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold disabled:opacity-40"
                      >
                        העתקה
                      </button>
                      {emails.length > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => record("email")}
                          className="rounded-full border border-lineDark px-4 py-2 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold disabled:opacity-40"
                        >
                          שליחה במייל
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setChosen(null)}
                        className="rounded-full px-3 py-2 text-[12.5px] text-appNavy/55 hover:text-appNavy"
                      >
                        {/* Back to the six situations, even when the
                            screen opened on one of them: somebody who
                            meant to write something else should not have
                            to close the drawer and find another button. */}
                        נוסח אחר
                      </button>
                    </div>
                  )}

                  {error && (
                    <p className="rounded-xl border border-error/30 bg-error-soft px-3 py-2 text-[12.5px] text-error">
                      {error}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
