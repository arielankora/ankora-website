"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { recordProcessCheckAction } from "../process-actions";
import { Field, INPUT } from "./knowledge-ui";

// The check of an ongoing process (org-brain spec 3.8): what was looked
// at, and what was found. The same form on the client's card and in the
// owner's routine on the home screen.

export function ProcessCheckForm({
  clientId,
  processId,
  checkText,
  steps,
  from,
}: {
  clientId: string;
  processId: string;
  checkText: string | null;
  steps: string[];
  from?: "home";
}) {
  const t = useTranslations("clients.processes.checkForm");
  const tc = useTranslations("clients.processes.common");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(recordProcessCheckAction, close);
  const [outcome, setOutcome] = useState<"OK" | "ISSUE">("OK");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={processId} />
      {from && <input type="hidden" name="from" value={from} />}
      {checkText && <p dir="auto" className="text-sm text-app-text-primary">{checkText}</p>}
      {steps.length > 0 && (
        <ol className="list-decimal space-y-0.5 ps-5 text-xs text-app-text-secondary">
          {steps.map((s, i) => (
            <li key={i} dir="auto">
              {s}
            </li>
          ))}
        </ol>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("legend")}</legend>
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          <input type="radio" name="outcome" value="OK" checked={outcome === "OK"} onChange={() => setOutcome("OK")} className="h-4 w-4 accent-gold" />
          {t("ok")}
        </label>
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          <input type="radio" name="outcome" value="ISSUE" checked={outcome === "ISSUE"} onChange={() => setOutcome("ISSUE")} className="h-4 w-4 accent-gold" />
          {t("issue")}
        </label>
      </fieldset>
      <Field label={outcome === "ISSUE" ? t("whatFound") : t("note")}>
        <textarea name="note" rows={3} required={outcome === "ISSUE"} maxLength={1000} className={INPUT} placeholder={outcome === "ISSUE" ? t("issuePlaceholder") : ""} />
      </Field>
      {outcome === "ISSUE" && <p className="text-xs text-app-text-secondary">{t("issueTask")}</p>}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? tc("saving") : t("record")}
      </button>
    </form>
  );
}
