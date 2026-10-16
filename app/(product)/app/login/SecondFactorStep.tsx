"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Fingerprint } from "lucide-react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { enrollFinishAction, enrollOptionsAction, passkeyLoginOptionsAction, passkeyLoginVerifyAction } from "./actions";

// The second step of signing in (lib/app-auth/second-factor.ts). The
// password, or the emailed link, was right; now the device answers with
// a fingerprint, a face or the device PIN.
//
// The prompt opens on a click, not on load: Safari refuses to start a
// passkey ceremony without a user gesture, and a button that says what
// is about to happen is clearer anyway.

const BUTTON =
  "mt-5 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-gold-gradient text-[15px] font-medium text-navy disabled:opacity-50";

function cancelled(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

export function SecondFactorStep({
  step,
  token,
  callbackUrl,
  restartHref,
}: {
  step: "passkey" | "enroll";
  token: string;
  callbackUrl: string;
  restartHref: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An error that ended the pending sign-in: the only way on is back to
  // the first step.
  const [expired, setExpired] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);
    const opts = await passkeyLoginOptionsAction(token);
    if (!opts.ok) {
      setBusy(false);
      setExpired(true);
      return setError(opts.error);
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: opts.options as any });
    } catch (err) {
      setBusy(false);
      return setError(cancelled(err) ? "האימות בוטל. אפשר לנסות שוב." : "המכשיר לא השלים את האימות.");
    }
    // On success the action redirects, and this component is gone.
    const done = await passkeyLoginVerifyAction(token, response, callbackUrl);
    setBusy(false);
    if (done?.error) {
      setExpired(true);
      setError(done.error);
    }
  }

  async function enroll(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = (e.currentTarget.elements.namedItem("name") as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    const opts = await enrollOptionsAction(token);
    if (!opts.ok) {
      setBusy(false);
      setExpired(true);
      return setError(opts.error);
    }
    let response;
    try {
      response = await startRegistration({ optionsJSON: opts.options as any });
    } catch (err) {
      setBusy(false);
      return setError(cancelled(err) ? "הרישום בוטל. אפשר לנסות שוב." : "המכשיר לא השלים את הרישום.");
    }
    const done = await enrollFinishAction(token, response, name, callbackUrl);
    setBusy(false);
    if (done?.error) {
      setExpired(true);
      setError(done.error);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-appNavy">
        <Fingerprint size={20} strokeWidth={1.6} />
        <h2 className="text-[15px] font-medium">
          {step === "passkey" ? "אימות דו-שלבי" : "הגדרת אימות דו-שלבי"}
        </h2>
      </div>

      {step === "passkey" ? (
        <p className="mt-2 text-[13.5px] leading-relaxed text-appNavy/65">
          הסיסמה נכונה. עכשיו אישור במכשיר: טביעת אצבע, זיהוי פנים או קוד המכשיר.
        </p>
      ) : (
        <p className="mt-2 text-[13.5px] leading-relaxed text-appNavy/65">
          החשבון הזה דורש אימות במכשיר בכל כניסה. רושמים את המכשיר פעם אחת, ומעכשיו נכנסים בסיסמה ובטביעת
          אצבע. כדאי לרשום אחר כך גם מכשיר שני מתוך הפרופיל.
        </p>
      )}

      {error && (
        <p className="mt-3.5 rounded-[10px] border border-error/30 bg-error-soft px-3 py-2.5 text-xs text-error">{error}</p>
      )}

      {expired ? (
        <Link href={restartHref} className={BUTTON}>
          חזרה לכניסה
        </Link>
      ) : step === "passkey" ? (
        <button type="button" onClick={verify} disabled={busy} className={BUTTON}>
          <Fingerprint size={17} strokeWidth={1.75} />
          {busy ? "ממתין למכשיר…" : "אימות במכשיר"}
        </button>
      ) : (
        <form onSubmit={enroll}>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs text-appNavy/60">שם למכשיר</span>
            <input
              name="name"
              type="text"
              required
              maxLength={60}
              placeholder="למשל: MacBook של דנה"
              className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-sm text-appNavy outline-none focus:border-gold"
            />
          </label>
          <button type="submit" disabled={busy} className={BUTTON}>
            <Fingerprint size={17} strokeWidth={1.75} />
            {busy ? "ממתין למכשיר…" : "רישום המכשיר וכניסה"}
          </button>
        </form>
      )}
    </div>
  );
}
