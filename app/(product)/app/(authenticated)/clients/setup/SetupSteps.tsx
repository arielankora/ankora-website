"use client";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionForm } from "@/components/app/useActionForm";
import {
  activateAction,
  addContactAction,
  addDomainAction,
  addPartnerAction,
  addRuleAction,
  noSpecialRulesAction,
  removeContactAction,
  removeDomainAction,
  removePartnerAction,
  removeRuleAction,
  setChannelAction,
  setTeamAction,
  startOnboardingAction,
  updateContactAction,
  updateIdentityAction,
  type SetupResult,
} from "../onboarding-actions";
import type { OnboardingState } from "@/lib/app-domain/client-onboarding";

// New-client wizard (26.11.2026): the four steps and the summary, as in
// the approved design. Every sub-form saves on its own, so leaving at any
// point loses nothing: "שמירה ויציאה" is only the way back to the list.

type Action = (prev: SetupResult | undefined, data: FormData) => Promise<SetupResult>;

const INPUT =
  "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const LABEL = "block text-xs font-medium text-app-text-secondary";
const CARD = "space-y-4 rounded-2xl border border-app-border bg-white p-5";
const PRIMARY = "tap-area rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50";
const SECONDARY = "tap-area rounded-full border border-app-border-strong bg-white px-4 py-2 text-sm text-app-text-primary disabled:opacity-50";
const GHOST = "tap-area rounded-lg px-3 py-2 text-sm text-app-text-accent";

function ActionForm({
  action,
  children,
  className,
  onOk,
  reset,
}: {
  action: Action;
  children: (pending: boolean) => ReactNode;
  className?: string;
  onOk?: (r: SetupResult) => void;
  reset?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, error } = useActionForm(action, (r) => {
    if (reset) ref.current?.reset();
    onOk?.(r);
  });
  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      {children(pending)}
      {error && (
        <p role="alert" className="mt-2 text-sm text-app-error">
          {error}
        </p>
      )}
    </form>
  );
}

function RemoveButton({ action, clientId, id, label }: { action: Action; clientId: string; id: string; label: string }) {
  return (
    <ActionForm action={action}>
      {(pending) => (
        <>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={pending} aria-label={label} className="tap-area flex h-11 w-11 items-center justify-center rounded-lg text-app-text-tertiary hover:bg-app-neutral-soft">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </>
      )}
    </ActionForm>
  );
}

function SourceTag({ source }: { source: string | null }) {
  const t = useTranslations("clients.setup");
  if (!source) return null;
  return <span className="inline-flex w-fit rounded-full bg-app-info-soft px-2 py-0.5 text-xs font-medium text-app-info">{t("fromSource", { source })}</span>;
}

function StepFooter({ clientId, back, next, nextLabel }: { clientId: string; back: string | null; next: string; nextLabel: string }) {
  const t = useTranslations("clients.setup");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <div className="flex flex-wrap gap-2">
        {back && (
          <Link href={`/app/clients/${clientId}/setup?step=${back}`} className={SECONDARY}>
            {t("back")}
          </Link>
        )}
        <Link href="/app/clients" className={GHOST}>
          {t("saveExit")}
        </Link>
      </div>
      <Link href={`/app/clients/${clientId}/setup?step=${next}`} className={PRIMARY}>
        {nextLabel}
      </Link>
    </div>
  );
}

function Heading({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-medium text-app-text-primary">{title}</h2>
      <p className="text-sm leading-relaxed text-app-text-secondary">{intro}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

export function IdentityStep({ state }: { state: OnboardingState | null }) {
  const t = useTranslations("clients.setup");
  const router = useRouter();
  const creating = !state;
  const ai = state ? (state.aiExcluded ? "true" : "false") : null;
  return (
    <>
      <Heading title={t("identity.heading")} intro={t("identity.intro")} />
      <ActionForm
        action={creating ? startOnboardingAction : updateIdentityAction}
        onOk={(r) => {
          if (creating && r.clientId) router.push(`/app/clients/${r.clientId}/setup?step=2`);
        }}
        className="space-y-4"
      >
        {(pending) => (
          <>
            {state && <input type="hidden" name="clientId" value={state.id} />}
            <div className={CARD}>
              <div>
                <label htmlFor="setup-name" className={LABEL}>{t("identity.name")}</label>
                <input id="setup-name" name="name" required defaultValue={state?.name ?? ""} className={INPUT} />
              </div>
              <fieldset className="space-y-2">
                <legend className={LABEL}>{t("identity.kind")}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["BUSINESS", "PRIVATE"] as const).map((k) => (
                    <label key={k} className="flex min-h-12 items-center gap-3 rounded-xl border border-app-border-strong px-3 py-2 has-[:checked]:border-gold">
                      <input type="radio" name="kind" value={k} defaultChecked={(state?.kind ?? "BUSINESS") === k} className="h-5 w-5 accent-[#B08D57]" />
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{k === "BUSINESS" ? t("identity.kindBusiness") : t("identity.kindPrivate")}</span>
                        <span className="text-xs text-app-text-secondary">{k === "BUSINESS" ? t("identity.kindBusinessHint") : t("identity.kindPrivateHint")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="setup-industry" className={LABEL}>{t("identity.industry")}</label>
                  <input id="setup-industry" name="industry" defaultValue={state?.industry ?? ""} placeholder={t("identity.industryPlaceholder")} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="setup-tz" className={LABEL}>{t("identity.timezone")}</label>
                  <select id="setup-tz" name="timezone" defaultValue={state?.timezone ?? "Asia/Jerusalem"} className={INPUT}>
                    <option value="Asia/Jerusalem">{t("identity.timezoneIsrael")}</option>
                    <option value="America/New_York">{t("identity.timezoneNewYork")}</option>
                    <option value="Europe/London">{t("identity.timezoneLondon")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-locale" className={LABEL}>{t("identity.locale")}</label>
                  <select id="setup-locale" name="communicationLocale" defaultValue={state?.communicationLocale ?? "he"} className={INPUT}>
                    <option value="he">{t("identity.localeHe")}</option>
                    <option value="en">{t("identity.localeEn")}</option>
                  </select>
                </div>
              </div>
            </div>
            <fieldset className={CARD}>
              <legend className="sr-only">{t("identity.aiTitle")}</legend>
              <div className="space-y-1">
                <p className="text-base font-medium text-app-text-primary">{t("identity.aiTitle")}</p>
                <p className="text-xs leading-relaxed text-app-text-secondary">{t("identity.aiIntro")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["false", "true"] as const).map((v) => (
                  <label key={v} className="flex items-start gap-3 rounded-xl border border-app-border-strong p-3 has-[:checked]:border-gold">
                    <input type="radio" name="aiExcluded" value={v} required defaultChecked={ai === v} className="mt-0.5 h-5 w-5 accent-[#B08D57]" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{v === "false" ? t("identity.aiAllowed") : t("identity.aiExcluded")}</span>
                      <span className="text-xs text-app-text-secondary">{v === "false" ? t("identity.aiAllowedHint") : t("identity.aiExcludedHint")}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/app/clients" className={GHOST}>
                {creating ? t("cancel") : t("saveExit")}
              </Link>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={creating ? PRIMARY : SECONDARY}>
                  {pending ? t("saving") : creating ? t("next.s1") : t("save")}
                </button>
                {state && (
                  <Link href={`/app/clients/${state.id}/setup?step=2`} className={PRIMARY}>
                    {t("next.s1saved")}
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </ActionForm>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------

export function LinkStep({ state }: { state: OnboardingState }) {
  const t = useTranslations("clients.setup");
  return (
    <>
      <Heading title={t("link.heading")} intro={t("link.intro")} />
      {state.kind === "PRIVATE" && (
        <div className="rounded-2xl bg-app-info-soft p-4 text-sm leading-relaxed text-app-text-primary">
          <p className="font-medium text-app-info">{t("link.privateTitle")}</p>
          <p>{t("link.privateBody")}</p>
        </div>
      )}
      <section className={CARD} aria-labelledby="setup-domains">
        <h3 id="setup-domains" className="text-base font-medium">{t("link.domains")}</h3>
        {state.domains.length === 0 ? (
          <p className="text-sm text-app-text-tertiary">{t("link.noDomains")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {state.domains.map((d) => (
              <li key={d.id} dir="ltr" className="flex items-center gap-1 rounded-full bg-app-neutral-soft ps-3 text-sm">
                {d.domain}
                <RemoveButton action={removeDomainAction} clientId={state.id} id={d.id} label={t("removeNamed", { name: d.domain })} />
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addDomainAction} reset className="flex flex-wrap items-end gap-2">
          {(pending) => (
            <>
              <input type="hidden" name="clientId" value={state.id} />
              <div className="min-w-[200px] flex-1">
                <label htmlFor="setup-domain" className={LABEL}>{t("link.domainAdd")}</label>
                <input id="setup-domain" name="domain" dir="ltr" required placeholder="example.co.il" className={INPUT} />
              </div>
              <button type="submit" disabled={pending} className={SECONDARY}>{t("add")}</button>
            </>
          )}
        </ActionForm>
      </section>

      <section className={CARD} aria-labelledby="setup-partners">
        <div>
          <h3 id="setup-partners" className="text-base font-medium">{t("link.partners")}</h3>
          <p className="text-xs text-app-text-secondary">{t("link.partnersHint")}</p>
        </div>
        {state.partners.length > 0 && (
          <ul className="divide-y divide-app-border">
            {state.partners.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{p.name}</span>
                  <SourceTag source={p.source} />
                </span>
                <span dir="ltr" className="text-sm">{p.domains.join(", ")}</span>
                <span className="text-sm text-app-text-secondary">{p.role}</span>
                <RemoveButton action={removePartnerAction} clientId={state.id} id={p.id} label={t("removeNamed", { name: p.name })} />
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addPartnerAction} reset className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          {(pending) => (
            <>
              <input type="hidden" name="clientId" value={state.id} />
              <div>
                <label htmlFor="setup-partner-name" className={LABEL}>{t("link.partnerName")}</label>
                <input id="setup-partner-name" name="name" required className={INPUT} />
              </div>
              <div>
                <label htmlFor="setup-partner-domain" className={LABEL}>{t("link.partnerDomain")}</label>
                <input id="setup-partner-domain" name="domain" dir="ltr" className={INPUT} />
              </div>
              <div>
                <label htmlFor="setup-partner-role" className={LABEL}>{t("link.partnerRole")}</label>
                <input id="setup-partner-role" name="role" className={INPUT} />
              </div>
              <button type="submit" disabled={pending} className={SECONDARY}>{t("link.addPartner")}</button>
            </>
          )}
        </ActionForm>
      </section>

      <ActionForm action={setChannelAction} className={CARD}>
        {(pending) => (
          <>
            <input type="hidden" name="clientId" value={state.id} />
            <fieldset className="space-y-3">
              <legend className="text-base font-medium">{t("link.channel")}</legend>
              <div className="flex flex-wrap gap-2">
                {(["WHATSAPP", "EMAIL", "PHONE"] as const).map((c) => (
                  <label key={c} className="flex min-h-11 items-center gap-2 rounded-xl border border-app-border-strong px-3 has-[:checked]:border-gold">
                    <input type="radio" name="preferredChannel" value={c} defaultChecked={state.preferredChannel === c} className="h-5 w-5 accent-[#B08D57]" />
                    <span className="text-sm">{t(`link.channel${c}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <label htmlFor="setup-wa" className={LABEL}>{t("link.whatsappNumber")}</label>
                <input id="setup-wa" name="whatsappNumber" dir="ltr" defaultValue={state.whatsappNumber ?? ""} className={INPUT} />
              </div>
              <button type="submit" disabled={pending} className={SECONDARY}>{pending ? t("saving") : t("save")}</button>
            </div>
          </>
        )}
      </ActionForm>

      <StepFooter clientId={state.id} back="1" next="3" nextLabel={t("next.s2")} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3
// ---------------------------------------------------------------------------

function ContactFields({ prefix, contact }: { prefix: string; contact?: OnboardingState["contacts"][number] }) {
  const t = useTranslations("clients.setup");
  const unreachable = contact && contact.emails.length === 0 && contact.phones.length === 0;
  const bad = unreachable ? " border-2 border-app-error" : "";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${prefix}-name`} className={LABEL}>{t("contacts.name")}</label>
          <input id={`${prefix}-name`} name="name" defaultValue={contact?.name ?? ""} className={INPUT} />
        </div>
        <div>
          <label htmlFor={`${prefix}-role`} className={LABEL}>{t("contacts.role")}</label>
          <input id={`${prefix}-role`} name="role" defaultValue={contact?.role ?? ""} className={INPUT} />
        </div>
        <div>
          <label htmlFor={`${prefix}-email`} className={LABEL}>{t("contacts.email")}</label>
          <input id={`${prefix}-email`} name="email" type="email" dir="ltr" defaultValue={contact?.emails[0] ?? ""} className={INPUT + bad} />
        </div>
        <div>
          <label htmlFor={`${prefix}-phone`} className={LABEL}>{t("contacts.phone")}</label>
          <input id={`${prefix}-phone`} name="phone" type="tel" dir="ltr" defaultValue={contact?.phones[0] ?? ""} className={INPUT + bad} />
        </div>
      </div>
      {unreachable && <p className="text-sm text-app-error">{t("contacts.missingReach")}</p>}
      <div className="flex flex-wrap gap-4">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="isDecisionMaker" defaultChecked={contact?.isDecisionMaker ?? false} className="h-5 w-5 accent-[#B08D57]" />
          {t("contacts.decisionMaker")}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary ?? false} className="h-5 w-5 accent-[#B08D57]" />
          {t("contacts.primary")}
        </label>
      </div>
    </>
  );
}

export function ContactsStep({ state }: { state: OnboardingState }) {
  const t = useTranslations("clients.setup");
  return (
    <>
      <Heading title={t("contacts.heading")} intro={t("contacts.intro")} />
      {state.contacts.length === 0 && <p className="text-sm text-app-text-tertiary">{t("contacts.none")}</p>}
      {state.contacts.map((c) => (
        <div key={c.id} className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-medium">{c.name ?? c.role}</span>
              {c.isPrimary && <span className="rounded-full bg-app-accent-soft px-2.5 py-0.5 text-xs font-medium text-app-text-accent">{t("contacts.primary")}</span>}
              <SourceTag source={c.source} />
            </div>
            <RemoveButton action={removeContactAction} clientId={state.id} id={c.id} label={t("removeNamed", { name: c.name ?? c.role ?? "" })} />
          </div>
          <ActionForm action={updateContactAction} className="space-y-3">
            {(pending) => (
              <>
                <input type="hidden" name="clientId" value={state.id} />
                <input type="hidden" name="id" value={c.id} />
                <ContactFields prefix={`contact-${c.id}`} contact={c} />
                <button type="submit" disabled={pending} className={SECONDARY}>{pending ? t("saving") : t("save")}</button>
              </>
            )}
          </ActionForm>
        </div>
      ))}
      <ActionForm action={addContactAction} reset className="space-y-3 rounded-2xl border-2 border-dashed border-app-border-strong bg-white p-5">
        {(pending) => (
          <>
            <input type="hidden" name="clientId" value={state.id} />
            <p className="text-base font-medium">{t("contacts.newContact")}</p>
            <ContactFields prefix="contact-new" />
            <button type="submit" disabled={pending} className={SECONDARY}>{t("contacts.addContact")}</button>
          </>
        )}
      </ActionForm>
      <StepFooter clientId={state.id} back="2" next="4" nextLabel={t("next.s3")} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4
// ---------------------------------------------------------------------------

export function RulesStep({ state, staff }: { state: OnboardingState; staff: { id: string; name: string }[] }) {
  const t = useTranslations("clients.setup");
  return (
    <>
      <Heading title={t("rules.heading")} intro={t("rules.intro")} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-app-border bg-white p-4">
        <span className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${state.aiExcluded ? "bg-app-neutral-soft text-app-text-secondary" : "bg-app-success-soft text-app-success"}`}>
            {state.aiExcluded ? t("rules.aiExcluded") : t("rules.aiAllowed")}
          </span>
          <span className="text-sm text-app-text-secondary">{t("rules.aiFromStep1")}</span>
        </span>
        <Link href={`/app/clients/${state.id}/setup?step=1`} className={GHOST}>{t("rules.change")}</Link>
      </div>

      <section className={CARD} aria-labelledby="setup-rules">
        <div>
          <h3 id="setup-rules" className="text-base font-medium">{t("rules.title")}</h3>
          <p className="text-xs text-app-text-secondary">{t("rules.hint")}</p>
        </div>
        {state.rules.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-app-border p-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-app-neutral-soft px-2 py-0.5 text-xs font-medium text-app-text-secondary">{t(`rules.kind${r.kind as "DATA_HANDLING" | "DISCLOSURE"}`)}</span>
                <span className="text-sm font-medium">{r.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "PROPOSED" ? "bg-app-warning-soft text-app-warning" : "bg-app-success-soft text-app-success"}`}>
                  {r.status === "PROPOSED" ? t("rules.proposed") : t("rules.active")}
                </span>
                <SourceTag source={r.source} />
              </div>
              <p className="text-sm leading-relaxed text-app-text-secondary">{r.statement}</p>
            </div>
            <RemoveButton action={removeRuleAction} clientId={state.id} id={r.id} label={t("removeNamed", { name: r.title })} />
          </div>
        ))}
        <ActionForm action={addRuleAction} reset className="grid gap-2 sm:grid-cols-[160px_1fr]">
          {(pending) => (
            <>
              <input type="hidden" name="clientId" value={state.id} />
              <div>
                <label htmlFor="setup-rule-kind" className={LABEL}>{t("rules.ruleKind")}</label>
                <select id="setup-rule-kind" name="kind" className={INPUT}>
                  <option value="DATA_HANDLING">{t("rules.kindDATA_HANDLING")}</option>
                  <option value="DISCLOSURE">{t("rules.kindDISCLOSURE")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="setup-rule-title" className={LABEL}>{t("rules.ruleTitle")}</label>
                <input id="setup-rule-title" name="title" required className={INPUT} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="setup-rule-statement" className={LABEL}>{t("rules.ruleStatement")}</label>
                <textarea id="setup-rule-statement" name="statement" required rows={2} className={INPUT} />
              </div>
              <div>
                <button type="submit" disabled={pending} className={SECONDARY}>{t("rules.addRule")}</button>
              </div>
            </>
          )}
        </ActionForm>
        {state.rules.length === 0 && (
          <ActionForm action={noSpecialRulesAction}>
            {(pending) => (
              <>
                <input type="hidden" name="clientId" value={state.id} />
                <input type="hidden" name="confirmed" value={state.noSpecialRules ? "false" : "true"} />
                <button
                  type="submit"
                  role="checkbox"
                  aria-checked={state.noSpecialRules}
                  disabled={pending}
                  className="tap-area flex min-h-11 items-center gap-2 text-sm text-app-text-primary"
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded border ${state.noSpecialRules ? "border-gold bg-app-accent" : "border-app-border-strong"}`} aria-hidden="true">
                    {state.noSpecialRules ? "✓" : ""}
                  </span>
                  {t("rules.noRules")}
                </button>
              </>
            )}
          </ActionForm>
        )}
      </section>

      <ActionForm action={setTeamAction} className={CARD}>
        {(pending) => (
          <>
            <input type="hidden" name="clientId" value={state.id} />
            <p className="text-base font-medium">{t("rules.team")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="setup-manager" className={LABEL}>{t("rules.manager")}</label>
                <select id="setup-manager" name="accountManagerId" defaultValue={state.accountManager?.id ?? ""} className={INPUT}>
                  <option value="">{t("rules.choose")}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="setup-backup" className={LABEL}>{t("rules.backup")}</label>
                <select id="setup-backup" name="backupManagerId" defaultValue={state.backupManager?.id ?? ""} className={INPUT}>
                  <option value="">{t("rules.choose")}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-app-text-secondary">{t("rules.teamHint")}</p>
            <button type="submit" disabled={pending} className={SECONDARY}>{pending ? t("saving") : t("save")}</button>
          </>
        )}
      </ActionForm>
      <p className="rounded-2xl bg-app-surface-sunken p-4 text-xs leading-relaxed text-app-text-secondary">{t("ready.proposedNote")}</p>
      <StepFooter clientId={state.id} back="3" next="summary" nextLabel={t("next.s4")} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary and activation
// ---------------------------------------------------------------------------

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-app-text-secondary">{k}</dt>
      <dd className="min-w-0">{v}</dd>
    </>
  );
}

function SummaryCard({ title, edit, children }: { title: string; edit: string; children: ReactNode }) {
  const t = useTranslations("clients.setup");
  return (
    <section className={CARD}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">{title}</h3>
        <Link href={edit} className={GHOST}>{t("edit")}</Link>
      </div>
      <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

export function SummaryStep({ state }: { state: OnboardingState }) {
  const t = useTranslations("clients.setup");
  const router = useRouter();
  const step = (n: number | "summary") => `/app/clients/${state.id}/setup?step=${n}`;
  const fromOther = [...state.partners, ...state.contacts, ...state.rules].filter((x) => x.source).length;
  const channel = state.preferredChannel ? t(`link.channel${state.preferredChannel}`) : t("summary.none");
  return (
    <>
      <Heading title={t("summary.heading")} intro={fromOther > 0 ? t("summary.fromOther", { count: fromOther }) : ""} />
      <div className="grid gap-4 xl:grid-cols-2">
        <SummaryCard title={t("steps.s1")} edit={step(1)}>
          <Row k={t("summary.kind")} v={state.kind === "PRIVATE" ? t("list.kindPRIVATE") : t("list.kindBUSINESS")} />
          <Row k={t("summary.timezoneLocale")} v={`${state.timezone}, ${state.communicationLocale === "en" ? t("identity.localeEn") : t("identity.localeHe")}`} />
          <Row k={t("summary.ai")} v={state.aiExcluded ? t("rules.aiExcluded") : t("rules.aiAllowed")} />
        </SummaryCard>
        <SummaryCard title={t("steps.s2")} edit={step(2)}>
          <Row k={t("summary.domains")} v={<span dir="ltr">{state.domains.map((d) => d.domain).join(", ") || t("summary.none")}</span>} />
          <Row k={t("summary.partners")} v={state.partners.map((p) => p.name).join(", ") || t("summary.none")} />
          <Row k={t("summary.channel")} v={channel} />
        </SummaryCard>
        <section className={CARD}>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium">{t("steps.s3")}</h3>
            <Link href={step(3)} className={GHOST}>{t("edit")}</Link>
          </div>
          <ul className="space-y-2 text-sm">
            {state.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span>{[c.name, c.role].filter(Boolean).join(", ")}</span>
                <SourceTag source={c.source} />
              </li>
            ))}
            {state.contacts.length === 0 && <li className="text-app-text-tertiary">{t("contacts.none")}</li>}
          </ul>
        </section>
        <SummaryCard title={t("steps.s4")} edit={step(4)}>
          <Row k={t("summary.rules")} v={state.rules.length ? t("summary.rulesCount", { count: state.rules.length }) : state.noSpecialRules ? t("summary.rulesNone") : t("summary.none")} />
          <Row k={t("summary.manager")} v={state.accountManager?.name ?? t("summary.none")} />
          <Row k={t("summary.backup")} v={state.backupManager?.name ?? t("summary.none")} />
        </SummaryCard>
      </div>

      <section className={CARD} aria-labelledby="setup-starts">
        <h3 id="setup-starts" className="text-base font-medium">{t("summary.startsTitle")}</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {(["Extraction", "Comms", "Agents", "Timer"] as const).map((k) => (
            <li key={k} className="flex flex-col">
              <span className="text-sm font-medium">{t(`summary.starts${k}`)}</span>
              <span className="text-xs text-app-text-secondary">{t(`summary.starts${k}Hint`)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-app-text-secondary">{t("summary.onlyHere")}</p>
      </section>

      {state.ready ? (
        <ActionForm action={activateAction} onOk={() => router.push(`/app/clients/${state.id}`)} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-app-surface-nav p-5 text-white">
          {(pending) => (
            <>
              <input type="hidden" name="clientId" value={state.id} />
              <div>
                <p className="text-base font-medium">{t("summary.readyTitle")}</p>
                <p className="text-xs text-white/80">{t("summary.readyBody")}</p>
              </div>
              <button type="submit" disabled={pending} className="tap-area rounded-full bg-app-accent px-6 py-3 text-sm font-medium text-app-text-primary disabled:opacity-50">
                {pending ? t("summary.activating") : t("summary.activate")}
              </button>
            </>
          )}
        </ActionForm>
      ) : (
        <section className="space-y-2 rounded-2xl bg-app-warning-soft p-5" aria-labelledby="setup-missing">
          <h3 id="setup-missing" className="text-base font-medium text-app-warning">{t("summary.missingTitle")}</h3>
          <ul className="space-y-1 text-sm">
            {state.missing.map((m) => (
              <li key={m.code}>
                <Link href={step(m.step)}>{t(`ready.req.${m.code}`)}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
