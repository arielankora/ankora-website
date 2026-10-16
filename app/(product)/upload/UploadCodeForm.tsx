"use client";
import { useFormState, useFormStatus } from "react-dom";
import { checkUploadCodeAction, uploadWithCodeAction, type UploadCodeState } from "./actions";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[46px] w-full rounded-full bg-gold-gradient px-6 text-[15px] font-medium text-navy disabled:opacity-50 sm:w-auto"
    >
      {pending ? busy : label}
    </button>
  );
}

function ErrorLine({ state }: { state: UploadCodeState | undefined }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="text-sm text-error">
      {state.error}
    </p>
  );
}

// Two steps, two forms. The second carries the code back in a hidden
// field and the server checks it again; nothing from the first step is
// trusted.
function FileStep({ ready }: { ready: NonNullable<UploadCodeState["ready"]> }) {
  const [state, action] = useFormState(uploadWithCodeAction, { ready });
  if (state?.done) {
    return (
      <p className="rounded-xl border border-lineDark bg-white p-4 text-sm text-appNavy">
        הקובץ התקבל. תודה. אנחנו נבדוק אותו ונעדכן אם צריך משהו נוסף. אפשר לסגור את הדף.
      </p>
    );
  }
  if (!state?.ready) return <CodeStep initialError={state?.error} />;
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-lineDark bg-white p-5">
      <p className="text-sm text-appNavy">
        {ready.firstName}, כאן מעלים את {ready.title} אחרי קריאה וחתימה.
      </p>
      <input type="hidden" name="code" value={ready.code} />
      <label className="block">
        <span className="mb-1.5 block text-xs text-appNavy/60">קובץ PDF חתום, עד 4MB</span>
        <input
          name="file"
          type="file"
          accept="application/pdf"
          required
          className="block w-full text-sm text-appNavy file:me-3 file:rounded-full file:border file:border-lineDark file:bg-cream file:px-4 file:py-2 file:text-xs file:text-appNavy"
        />
      </label>
      <ErrorLine state={state} />
      <Submit label="העלאת הקובץ" busy="מעלה..." />
    </form>
  );
}

function CodeStep({ initialError }: { initialError?: string }) {
  const [state, action] = useFormState(checkUploadCodeAction, initialError ? { error: initialError } : {});
  if (state?.ready) return <FileStep ready={state.ready} />;
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-lineDark bg-white p-5">
      <label className="block">
        <span className="mb-1.5 block text-xs text-appNavy/60">קוד ההעלאה מהמייל</span>
        <input
          name="code"
          type="text"
          required
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          dir="ltr"
          placeholder="XXXX-XXXX"
          maxLength={20}
          className="w-full rounded-[10px] border border-lineDark bg-white px-3.5 py-3 text-center font-jbmono text-lg tracking-[0.2em] text-appNavy outline-none focus:border-gold"
        />
      </label>
      <ErrorLine state={state} />
      <Submit label="המשך" busy="בודק..." />
    </form>
  );
}

export function UploadCodeForm() {
  return <CodeStep />;
}
