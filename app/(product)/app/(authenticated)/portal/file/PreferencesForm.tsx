"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { savePreferencesAction, saveDigestAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import type { PortalDigest } from "@prisma/client";

// Portal phase 3. The one part of the client's file the client writes.
//
// Three questions, in the client's own words, and deliberately not a
// settings panel: these are the answers the intake call already asks for,
// and a row of toggles would throw away the half of each answer that
// actually changes how we work. "אל תתקשרו לפני תשע" has no checkbox.

// ADR 0006: each field's label and example are in the dictionary, under
// portal.preferences.fields.<name>.
const FIELDS = ["contact", "matters", "never"] as const;

/// In the order the choices are offered (portal.preferences.digest).
const DIGESTS: PortalDigest[] = ["EVERY_DECISION", "WEEKLY", "MONTHLY"];

export function PreferencesForm({
  preferences,
  canEdit,
}: {
  preferences: { contact: string | null; matters: string | null; never: string | null };
  canEdit: boolean;
}) {
  const t = useTranslations("portal.preferences");
  const { onSubmit, pending, error, ok } = useActionForm(savePreferencesAction);

  if (!canEdit) {
    return (
      <div className="space-y-3.5">
        {FIELDS.map((name) => (
          <div key={name}>
            <p className="text-[11.5px] text-app-text-secondary">{t(`fields.${name}.label`)}</p>
            {preferences[name]?.trim() ? (
              <p dir="auto" className="mt-1 whitespace-pre-line text-page-start text-[13.5px] text-app-text-primary">
                {preferences[name]?.trim()}
              </p>
            ) : (
              <p className="mt-1 whitespace-pre-line text-[13.5px] text-app-text-primary">
                <span className="text-app-text-tertiary">{t("notRecorded")}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      {FIELDS.map((name) => (
        <label key={name} className="block">
          <span className="mb-1.5 block text-[11.5px] text-app-text-secondary">{t(`fields.${name}.label`)}</span>
          <textarea
            name={name}
            dir="auto"
            rows={2}
            defaultValue={preferences[name] ?? ""}
            placeholder={t(`fields.${name}.placeholder`)}
            className="w-full rounded-[10px] border border-app-border-strong bg-white px-3 py-2.5 text-[13.5px] text-app-text-primary outline-none placeholder:text-app-text-tertiary focus:border-gold"
          />
        </label>
      ))}

      {error && <p className="text-[12.5px] text-app-error">{error}</p>}
      {ok && <p className="text-[12.5px] text-app-success">{t("saved")}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}

/// How often we reach out. Its own form, because it saves on choice
/// rather than on a button: a person changing how often they hear from us
/// has already decided, and asking them to confirm it adds a step to the
/// one screen whose whole job is to remove them.
export function DigestForm({ digest, canEdit }: { digest: PortalDigest; canEdit: boolean }) {
  const t = useTranslations("portal.preferences");
  const [value, setValue] = useState<PortalDigest>(digest);
  const { onSubmit, pending, error, ok } = useActionForm(saveDigestAction);

  if (!canEdit) {
    return <p className="text-[13.5px] text-app-text-primary">{t(`digest.${digest}`)}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="digest" value={value} />
      <div className="flex flex-col gap-2">
        {DIGESTS.map((key) => (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13.5px] ${
              value === key ? "border-gold bg-gold/10 text-app-text-primary" : "border-app-border bg-white text-app-text-secondary"
            }`}
          >
            <input
              type="radio"
              name="digestChoice"
              checked={value === key}
              onChange={() => setValue(key)}
              className="h-4 w-4"
            />
            {t(`digest.${key}`)}
          </label>
        ))}
      </div>

      {error && <p className="text-[12.5px] text-app-error">{error}</p>}
      {ok && <p className="text-[12.5px] text-app-success">{t("digestSaved")}</p>}

      <button
        type="submit"
        disabled={pending || value === digest}
        className="rounded-full border border-app-border px-4 py-2 text-[13px] text-app-text-primary disabled:opacity-40"
      >
        {pending ? t("saving") : t("saveDigest")}
      </button>
    </form>
  );
}
