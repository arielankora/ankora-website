"use client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useActionForm } from "@/components/app/useActionForm";
import { discardOnboardingAction } from "./onboarding-actions";
import type { OnboardingRequirement } from "@/lib/client-onboarding";

// New-client wizard (26.11.2026): the clients being set up, above the
// active ones, with what each still needs and who touched it last.

/// A setup nobody touched for this long is called out as stuck (Ariel
/// approved 14 days on 26.11.2026).
export const STUCK_AFTER_DAYS = 14;

export type OnboardingRow = {
  id: string;
  name: string;
  kind: "BUSINESS" | "PRIVATE";
  step: number;
  missing: OnboardingRequirement[];
  lastEditedAt: Date;
  lastEditedBy: string | null;
};

function DiscardButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("clients.setup.list");
  const { onSubmit, pending, error } = useActionForm(discardOnboardingAction);
  return (
    <form
      onSubmit={(e) => {
        if (!window.confirm(t("discardConfirm", { name }))) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
    >
      <input type="hidden" name="clientId" value={id} />
      <button type="submit" disabled={pending} aria-label={t("discard", { name })} className="tap-area flex h-11 w-11 items-center justify-center rounded-lg text-app-text-tertiary hover:bg-app-neutral-soft">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M3 5h12M7 5V3h4v2M5 5l1 10h6l1-10" />
        </svg>
      </button>
      {error && <p role="alert" className="text-xs text-app-error">{error}</p>}
    </form>
  );
}

export function OnboardingSection({ rows, now }: { rows: OnboardingRow[]; now: Date }) {
  const t = useTranslations("clients.setup");
  const format = useFormatter();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="onboarding-title" className="space-y-3 rounded-2xl border border-app-border bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="onboarding-title" className="text-base font-medium text-app-text-primary">{t("list.title")}</h2>
        <span className="rounded-full bg-app-accent-soft px-2.5 py-0.5 text-xs font-medium text-app-text-accent">{rows.length}</span>
        <span className="text-xs text-app-text-secondary">{t("list.note")}</span>
      </div>
      <ul className="divide-y divide-app-border">
        {rows.map((r) => {
          const days = Math.floor((now.getTime() - new Date(r.lastEditedAt).getTime()) / 86_400_000);
          return (
            <li key={r.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1.2fr)_160px_minmax(0,1.4fr)_160px_auto] md:items-center">
              <span className="flex flex-col">
                <span dir="auto" className="text-sm font-medium text-app-text-primary">{r.name}</span>
                <span className="text-xs text-app-text-secondary">{t(`list.kind${r.kind}`)}</span>
              </span>
              <span className="flex flex-col gap-1.5">
                <span className="text-xs">{t("list.step", { step: r.step })}</span>
                <span aria-hidden="true" className="grid grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={`h-1.5 rounded-full ${n < r.step ? "bg-app-success" : n === r.step ? "bg-app-accent" : "bg-app-border"}`} />
                  ))}
                </span>
              </span>
              <span className="text-xs leading-relaxed text-app-text-primary">
                {r.missing.length === 0 ? t("list.readyToActivate") : r.missing.map((m) => t(`ready.req.${m}`)).join(", ")}
              </span>
              <span className="flex flex-col gap-1 text-xs">
                <span>{format.relativeTime(new Date(r.lastEditedAt), now)}</span>
                {r.lastEditedBy && <span className="text-app-text-secondary">{r.lastEditedBy}</span>}
                {days >= STUCK_AFTER_DAYS && <span className="w-fit rounded-full bg-app-warning-soft px-2 py-0.5 font-medium text-app-warning">{t("list.stuck")}</span>}
              </span>
              <span className="flex items-center gap-2 md:justify-end">
                <Link href={`/app/clients/${r.id}/setup?step=${r.missing.length === 0 ? "summary" : r.step}`} className="tap-area rounded-full border border-app-border-strong px-4 py-2 text-sm text-app-text-primary hover:border-gold">
                  {t("list.continue")}
                </Link>
                <DiscardButton id={r.id} name={r.name} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-app-text-secondary">{t("list.released")}</p>
    </section>
  );
}
