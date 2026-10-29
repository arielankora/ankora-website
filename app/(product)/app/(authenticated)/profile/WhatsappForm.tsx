"use client";
import { updateWhatsappNumberAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירה"}
    </button>
  );
}

// 28.10.2026: the number "שיתוף" on a task opens a WhatsApp chat with.
// Without it a colleague can still share by email, and the share panel
// says whose number is missing rather than offering a dead button.
export function WhatsappForm({ whatsappNumber }: { whatsappNumber: string | null }) {
  const { onSubmit, pending, error, ok } = useActionForm(updateWhatsappNumberAction);

  return (
    <form onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-app-text-secondary">מספר וואטסאפ</span>
        <input
          name="whatsappNumber"
          type="tel"
          dir="ltr"
          defaultValue={whatsappNumber ?? ""}
          maxLength={30}
          placeholder="050-000-0000"
          data-testid="profile-whatsapp"
          className="w-full rounded-lg border border-app-border-strong bg-white px-3.5 py-2.5 text-end text-sm text-app-text-primary outline-none focus:border-gold"
        />
        <span className="mt-1.5 block text-[11.5px] text-app-text-tertiary">
          כך עמיתים יוכלו לשלוח לך משימה בוואטסאפ. אפשר להשאיר ריק.
        </span>
      </label>

      {error && <p className="mt-2 text-xs text-app-error">{error}</p>}
      {ok && <p className="mt-2 text-xs text-app-success">המספר נשמר.</p>}

      <SubmitButton pending={pending} />
    </form>
  );
}
