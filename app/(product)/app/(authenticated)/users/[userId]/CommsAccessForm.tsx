"use client";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import type { CommsAccessLevel } from "@prisma/client";
import { setCommsAccessAction } from "../actions";
import { COMMS_LEVELS, levelNeedsConfidentiality } from "@/lib/comms/grant-rules";

// The communications screen, given from the person's page (12.11.2026).
// Until today it was an edit to Vercel's environment and a redeploy.

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("users.commsAccess");
  return (
    <button type="submit" disabled={pending} className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-primary disabled:opacity-50">
      {pending ? t("saving") : t("save")}
    </button>
  );
}

export type CommsLineChoice = { line: string; mine: boolean; otherOwner: string | null };

export function CommsAccessForm(props: {
  userId: string;
  level: CommsAccessLevel;
  environmentLevel: CommsAccessLevel;
  confidentialitySigned: boolean;
  lines: CommsLineChoice[];
}) {
  const t = useTranslations("users.commsAccess");
  // ADR 0006: the labels are the screen's; COMMS_LEVEL_LABEL in
  // lib/comms/grant-rules.ts keeps the Hebrew the refusals quote.
  const levelLabel = (l: CommsAccessLevel) => t(`levels.${l}`);
  const [state, formAction] = useFormState(setCommsAccessAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="userId" value={props.userId} />
      <label className="block text-sm text-app-text-primary">
        {t("label")}
        <select
          name="level"
          defaultValue={props.level}
          className="mt-1 block w-full max-w-sm rounded-lg border border-app-border bg-white px-3 py-2 text-sm"
        >
          {COMMS_LEVELS.map((l) => (
            <option key={l} value={l} disabled={levelNeedsConfidentiality(l) && !props.confidentialitySigned && l !== props.level}>
              {levelLabel(l)}
            </option>
          ))}
        </select>
      </label>

      {!props.confidentialitySigned && (
        <p className="text-xs text-app-text-tertiary">
          {t("needsConfidentiality")}
        </p>
      )}
      {props.environmentLevel !== "NONE" && (
        <p className="text-xs text-app-text-tertiary">
          {t("environmentLevel", { level: levelLabel(props.environmentLevel) })}
        </p>
      )}

      {props.lines.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm text-app-text-primary">{t("lines")}</legend>
          {props.lines.map((l) => (
            <label key={l.line} className="flex items-center gap-2 text-sm text-app-text-primary">
              <input type="checkbox" name="line" value={l.line} defaultChecked={l.mine} className="h-4 w-4 accent-gold" />
              <span dir="ltr">{l.line}</span>
              {!l.mine && l.otherOwner && <span className="text-xs text-app-text-tertiary">{t("lineOwner", { name: l.otherOwner })}</span>}
            </label>
          ))}
          <p className="text-xs text-app-text-tertiary">{t("linesHint")}</p>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state?.error && <p className="text-sm text-app-error">{state.error}</p>}
        {state?.ok && <p className="text-sm text-app-success">{t("saved")}</p>}
      </div>
    </form>
  );
}
