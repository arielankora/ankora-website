"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { OnboardingRequirement } from "@/lib/client-onboarding";

// New-client wizard (26.11.2026), option B of the approved design: the
// steps on the side, the step in the middle, and "מוכן להפעלה?" beside
// it, which says what each detail turns on.

export type SetupStep = 1 | 2 | 3 | 4 | "summary";

export type SetupSummary = {
  id: string;
  name: string;
  kind: "BUSINESS" | "PRIVATE";
  aiExcluded: boolean;
  step: number;
  domains: number;
  partners: number;
  contacts: number;
  missing: { code: OnboardingRequirement; step: number }[];
};

const GROUPS: { key: "meetings" | "comms" | "channel" | "rules" | "team"; codes: OnboardingRequirement[]; step: number }[] = [
  { key: "meetings", codes: ["domainOrPersonalEmail"], step: 2 },
  { key: "channel", codes: ["preferredChannel"], step: 2 },
  { key: "comms", codes: ["contact", "contactReachable"], step: 3 },
  { key: "rules", codes: ["rulesDecided"], step: 4 },
  { key: "team", codes: ["accountManager", "backupManager", "distinctBackup"], step: 4 },
];

const STEP_KEYS = ["s1", "s2", "s3", "s4"] as const;

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function SetupLayout({ summary, current, children }: { summary: SetupSummary | null; current: SetupStep; children: ReactNode }) {
  const t = useTranslations("clients.setup");
  const href = (s: SetupStep) => (summary ? `/app/clients/${summary.id}/setup?step=${s}` : "/app/clients/new");
  const reached = summary?.step ?? 0;
  const stepNote = (n: number) => {
    if (!summary) return null;
    if (n === 1) return `${summary.kind === "PRIVATE" ? t("list.kindPRIVATE") : t("list.kindBUSINESS")}, ${summary.aiExcluded ? t("rules.aiExcluded") : t("rules.aiAllowed")}`;
    return null;
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)_320px] lg:gap-8">
      <nav aria-label={t("stepsLabel")} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 dir="auto" className="text-xl font-medium text-app-text-primary">{summary?.name ?? t("title")}</h1>
          {summary && <span className="rounded-full bg-app-accent-soft px-2.5 py-0.5 text-xs font-medium text-app-text-accent">{t("badge")}</span>}
        </div>
        <ol className="flex gap-2 overflow-x-auto lg:flex-col">
          {[1, 2, 3, 4].map((n) => {
            const done = n < (current === "summary" ? 5 : current) && n <= Math.max(reached, 1) && !!summary;
            const isCurrent = current === n;
            const label = t(`steps.${STEP_KEYS[n - 1]}`);
            const inner = (
              <span className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm ${
                    isCurrent ? "bg-app-accent font-medium text-app-text-primary" : done ? "bg-app-success-soft text-app-success" : "border border-app-border-strong text-app-text-tertiary"
                  }`}
                >
                  {done && !isCurrent ? <Check /> : n}
                </span>
                <span className="flex flex-col">
                  <span className={`text-sm ${isCurrent ? "font-medium text-app-text-primary" : "text-app-text-secondary"}`}>{label}</span>
                  {done && stepNote(n) && <span className="text-xs text-app-text-tertiary">{stepNote(n)}</span>}
                </span>
              </span>
            );
            return (
              <li key={n} aria-current={isCurrent ? "step" : undefined} className="flex-none">
                {summary && !isCurrent ? (
                  <Link href={href(n as SetupStep)} className="tap-area flex min-h-12 items-center rounded-xl px-3 hover:bg-white">
                    {inner}
                  </Link>
                ) : (
                  <div className={`flex min-h-12 items-center rounded-xl px-3 ${isCurrent ? "border border-app-border bg-white" : ""}`}>{inner}</div>
                )}
              </li>
            );
          })}
          {summary && (
            <li aria-current={current === "summary" ? "step" : undefined} className="flex-none">
              <Link
                href={href("summary")}
                className={`tap-area flex min-h-12 items-center rounded-xl px-3 text-sm ${current === "summary" ? "border border-app-border bg-white font-medium" : "text-app-text-secondary hover:bg-white"}`}
              >
                {t("steps.summary")}
              </Link>
            </li>
          )}
        </ol>
      </nav>

      <main className="min-w-0 space-y-4">{children}</main>

      <aside aria-label={t("ready.title")} className="space-y-4">
        <div className="space-y-4 rounded-2xl border border-app-border bg-white p-5">
          <div>
            <p className="text-base font-medium text-app-text-primary">{t("ready.title")}</p>
            <p className="text-xs text-app-text-secondary">{t("ready.subtitle")}</p>
          </div>
          <ul className="space-y-3">
            {GROUPS.map((g) => {
              const miss = summary ? summary.missing.filter((m) => g.codes.includes(m.code)) : g.codes.map((code) => ({ code, step: g.step }));
              const ok = !!summary && miss.length === 0;
              const notYet = !ok && (!summary || (current !== "summary" && g.step > (typeof current === "number" ? current : 4)));
              return (
                <li key={g.key} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-medium ${
                      ok ? "bg-app-success-soft text-app-success" : notYet ? "border border-app-border-strong" : "bg-app-warning-soft text-app-warning"
                    }`}
                    aria-hidden="true"
                  >
                    {ok ? <Check /> : notYet ? "" : "!"}
                  </span>
                  <span className="flex flex-col">
                    <span className={`text-sm ${notYet ? "text-app-text-secondary" : "font-medium text-app-text-primary"}`}>{t(`ready.${g.key}`)}</span>
                    {!ok && (
                      <span className={`text-xs ${notYet ? "text-app-text-tertiary" : "text-app-warning"}`}>
                        {notYet ? t("ready.inStep", { step: g.step }) : miss.map((m) => t(`ready.req.${m.code}`)).join(", ")}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="rounded-2xl bg-app-surface-sunken p-4 text-xs leading-relaxed text-app-text-secondary">{t("ready.note")}</p>
      </aside>
    </div>
  );
}
