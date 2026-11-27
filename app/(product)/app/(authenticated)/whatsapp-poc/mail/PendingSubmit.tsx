"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

/// The submit button of a form on the mail screens (27.11.2026, Ariel: a
/// press on the buttons seemed to do nothing, and he pressed several times
/// before something happened). While the action runs, the button is
/// disabled, shows a spinner and says it is working, so a second press does
/// not send the action again.
export function PendingSubmit({ className, children }: { className: string; children: React.ReactNode }) {
  const t = useTranslations("comms.mail");
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} inline-flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      <span>{pending ? t("working") : children}</span>
    </button>
  );
}
