"use client";
import { useFormState, useFormStatus } from "react-dom";
import { uploadSignedPdfAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[46px] w-full rounded-full bg-app-accent px-6 text-[15px] font-medium text-app-text-primary disabled:opacity-50 sm:w-auto"
    >
      {pending ? "מעלה..." : "העלאת הקובץ"}
    </button>
  );
}

export function UploadForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(uploadSignedPdfAction, {});

  if (state?.done) {
    return (
      <p className="rounded-xl border border-app-border bg-white p-4 text-sm text-app-text-primary">
        הקובץ התקבל. תודה. אנחנו נבדוק אותו ונעדכן אם צריך משהו נוסף. אפשר לסגור את הדף.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-app-border bg-white p-5">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="mb-1.5 block text-xs text-app-text-secondary">קובץ PDF חתום, עד 4MB</span>
        <input
          name="file"
          type="file"
          accept="application/pdf"
          required
          className="block w-full text-sm text-app-text-primary file:me-3 file:rounded-full file:border file:border-app-border file:bg-app-surface-page file:px-4 file:py-2 file:text-xs file:text-app-text-primary"
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-app-error">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
