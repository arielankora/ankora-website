"use client";
import { useState } from "react";
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
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(recordProcessCheckAction, close);
  const [outcome, setOutcome] = useState<"OK" | "ISSUE">("OK");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="processId" value={processId} />
      {from && <input type="hidden" name="from" value={from} />}
      {checkText && <p className="text-sm text-appNavy">{checkText}</p>}
      {steps.length > 0 && (
        <ol className="list-decimal space-y-0.5 pr-5 text-xs text-appNavy/70">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">מה נמצא</legend>
        <label className="flex items-center gap-2 text-sm text-appNavy">
          <input type="radio" name="outcome" value="OK" checked={outcome === "OK"} onChange={() => setOutcome("OK")} className="h-4 w-4 accent-gold" />
          נבדק, הכול תקין
        </label>
        <label className="flex items-center gap-2 text-sm text-appNavy">
          <input type="radio" name="outcome" value="ISSUE" checked={outcome === "ISSUE"} onChange={() => setOutcome("ISSUE")} className="h-4 w-4 accent-gold" />
          נמצאה בעיה
        </label>
      </fieldset>
      <Field label={outcome === "ISSUE" ? "מה נמצא *" : "הערה"}>
        <textarea name="note" rows={3} required={outcome === "ISSUE"} maxLength={1000} className={INPUT} placeholder={outcome === "ISSUE" ? "שתי חשבוניות של Notion לא הגיעו ל-billing" : ""} />
      </Field>
      {outcome === "ISSUE" && <p className="text-xs text-appNavy/60">תיפתח לך משימה עם מה שנמצא, להיום.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "רישום הבדיקה"}
      </button>
    </form>
  );
}
