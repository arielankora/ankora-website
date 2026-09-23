"use client";
import { useState } from "react";
import { savePreferencesAction, saveDigestAction } from "./actions";
import { useActionForm } from "@/components/app/useActionForm";
import { DIGEST_LABELS } from "@/lib/app-domain/portal-labels";
import type { PortalDigest } from "@prisma/client";

// Portal phase 3. The one part of the client's file the client writes.
//
// Three questions, in the client's own words, and deliberately not a
// settings panel: these are the answers the intake call already asks for,
// and a row of toggles would throw away the half of each answer that
// actually changes how we work. "אל תתקשרו לפני תשע" has no checkbox.

const FIELDS = [
  {
    name: "contact",
    label: "איך לדבר איתי",
    placeholder: "וואטסאפ עדיף. שיחות רק אחרי תשע, ולא בימי שישי.",
  },
  {
    name: "matters",
    label: "מה חשוב לי",
    placeholder: "שהכול יהיה סגור לפני שאני שומע עליו. עדיף לשלם יותר ולא להתעסק.",
  },
  {
    name: "never",
    label: "מה אסור שיקרה",
    placeholder: "שמישהו יגיע הביתה בלי שתיאמו איתי קודם.",
  },
] as const;

export function PreferencesForm({
  preferences,
  canEdit,
}: {
  preferences: { contact: string | null; matters: string | null; never: string | null };
  canEdit: boolean;
}) {
  const { onSubmit, pending, error, ok } = useActionForm(savePreferencesAction);

  if (!canEdit) {
    return (
      <div className="space-y-3.5">
        {FIELDS.map((f) => (
          <div key={f.name}>
            <p className="text-[11.5px] text-appNavy/55">{f.label}</p>
            <p className="mt-1 whitespace-pre-line text-[13.5px] text-appNavy">
              {preferences[f.name]?.trim() || <span className="text-appNavy/40">עוד לא נרשם</span>}
            </p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      {FIELDS.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1.5 block text-[11.5px] text-appNavy/55">{f.label}</span>
          <textarea
            name={f.name}
            rows={2}
            defaultValue={preferences[f.name] ?? ""}
            placeholder={f.placeholder}
            className="w-full rounded-[10px] border border-lineDark bg-white px-3 py-2.5 text-[13.5px] text-appNavy outline-none placeholder:text-appNavy/30 focus:border-gold"
          />
        </label>
      ))}

      {error && <p className="text-[12.5px] text-error">{error}</p>}
      {ok && <p className="text-[12.5px] text-success">נשמר. מנהל התיק שלך קיבל על זה הודעה.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
      >
        {pending ? "שומר..." : "שמירה"}
      </button>
    </form>
  );
}

/// How often we reach out. Its own form, because it saves on choice
/// rather than on a button: a person changing how often they hear from us
/// has already decided, and asking them to confirm it adds a step to the
/// one screen whose whole job is to remove them.
export function DigestForm({ digest, canEdit }: { digest: PortalDigest; canEdit: boolean }) {
  const [value, setValue] = useState<PortalDigest>(digest);
  const { onSubmit, pending, error, ok } = useActionForm(saveDigestAction);

  if (!canEdit) {
    return <p className="text-[13.5px] text-appNavy">{DIGEST_LABELS[digest]}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="digest" value={value} />
      <div className="flex flex-col gap-2">
        {(Object.keys(DIGEST_LABELS) as PortalDigest[]).map((key) => (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13.5px] ${
              value === key ? "border-gold bg-gold/10 text-appNavy" : "border-lineDark bg-white text-appNavy/70"
            }`}
          >
            <input
              type="radio"
              name="digestChoice"
              checked={value === key}
              onChange={() => setValue(key)}
              className="h-4 w-4"
            />
            {DIGEST_LABELS[key]}
          </label>
        ))}
      </div>

      {error && <p className="text-[12.5px] text-error">{error}</p>}
      {ok && <p className="text-[12.5px] text-success">עודכן.</p>}

      <button
        type="submit"
        disabled={pending || value === digest}
        className="rounded-full border border-lineDark px-4 py-2 text-[13px] text-appNavy disabled:opacity-40"
      >
        {pending ? "שומר..." : "שמירת התדירות"}
      </button>
    </form>
  );
}
