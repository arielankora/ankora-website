"use client";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

// The two things a signature consists of here: an explicit tick, and the
// signer's full name typed by hand. Both are checked again on the server;
// `required` only saves a round trip.
//
// Both fields are controlled. React 19 resets a form's uncontrolled fields
// after its action returns, so a name refused for a typo would otherwise
// come back empty along with the tick, and the person would type it all
// again to fix one letter.

export type AgreementSignState = { error?: string; done?: boolean };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[46px] w-full rounded-full bg-gold-gradient px-6 text-[15px] font-medium text-navy disabled:opacity-50 sm:w-auto"
    >
      {pending ? "שומר..." : "אישור וחתימה"}
    </button>
  );
}

export function AgreementSignForm({
  action,
  version,
  consentLabel,
  token,
  doneMessage,
}: {
  action: (prev: AgreementSignState | undefined, formData: FormData) => Promise<AgreementSignState>;
  version: string;
  consentLabel: string;
  /// Only on the one-time link page.
  token?: string;
  /// Shown in place of the form once the action reports `done`. The
  /// in-app page never sees it: its action redirects instead.
  doneMessage?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  const [consent, setConsent] = useState(false);
  const [signedName, setSignedName] = useState("");

  if (state?.done) {
    return <p className="rounded-xl border border-lineDark bg-white p-4 text-sm text-appNavy">{doneMessage}</p>;
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-lineDark bg-white p-5">
      <input type="hidden" name="version" value={version} />
      {token && <input type="hidden" name="token" value={token} />}

      <label className="flex items-start gap-3 text-sm text-appNavy">
        <input
          type="checkbox"
          name="consent"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 accent-gold"
        />
        <span>{consentLabel}</span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs text-appNavy/60">שם מלא</span>
        <input
          name="signedName"
          type="text"
          required
          value={signedName}
          onChange={(e) => setSignedName(e.target.value)}
          autoComplete="name"
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-sm text-appNavy outline-none focus:border-gold"
        />
        <span className="mt-1.5 block text-xs text-appNavy/50">כפי שהוא רשום בחשבון. ההקלדה היא החתימה.</span>
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-error">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
