"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import {
  SOURCE_KIND_LABELS,
  defaultWeight,
  isClientConversation,
  type SourceKindLike,
  type SourceWeightLike,
} from "@/lib/knowledge-sources";
import {
  addClientSourceAction,
  removeClientSourceAction,
  addClientDomainAction,
  removeClientDomainAction,
  confirmSourceWithClientAction,
  setClientSourceAnchorsAction,
} from "../source-actions";

// Org brain, phase 2: the source register ("מקרא מקורות" in Hadas's file)
// and the client's domains (claude/org-brain-spec-2026-10-12.md, 3.2 and
// 3.5).
//
// The register is short on purpose: a code, what it was, when. Every item
// above it cites these codes, so a reader can always ask "says who?" and
// get an answer in one glance.

export type PanelSource = {
  id: string;
  code: string;
  kind: SourceKindLike;
  weight: SourceWeightLike;
  title: string;
  occurredAt: string | null;
  participants: string[];
  topicsOnly: boolean;
  notes: string | null;
};

/// Where the client's material lives outside Ankora, beside the domains.
export type PanelAnchors = {
  keywords: string[];
  driveFolderId: string | null;
  conversationsDocId: string | null;
};

export type PanelDomain = {
  id: string;
  domain: string;
  kind: "CLIENT" | "PARTNER";
  organizationName: string | null;
};

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const LABEL = "block text-xs font-medium text-app-text-secondary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/// The kinds that take an external id, and what it is called
/// (clients.sources.form.externalId).
const EXTERNAL_LABEL: Partial<Record<SourceKindLike, "fireflies" | "document" | "task">> = {
  TRANSCRIPT: "fireflies",
  CLIENT_DOCUMENT: "document",
  ANKORA_DOCUMENT: "document",
  TASK: "task",
};

function SourceForm({ clientId }: { clientId: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addClientSourceAction, close);
  const [kind, setKind] = useState<SourceKindLike>("TRANSCRIPT");
  const [weight, setWeight] = useState<SourceWeightLike>("PRIMARY");
  const t = useTranslations("clients.sources");
  const external = EXTERNAL_LABEL[kind];
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.kind")}>
          <select
            name="kind"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as SourceKindLike;
              setKind(k);
              setWeight(defaultWeight(k));
            }}
            className={INPUT}
          >
            {(Object.keys(SOURCE_KIND_LABELS) as SourceKindLike[]).map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("form.date")}>
          <input name="occurredAt" type="date" dir="ltr" className={INPUT} />
        </Field>
      </div>
      <Field label={t("form.title")}>
        <input name="title" required placeholder={t("form.titlePlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("form.participants")}>
        <input name="participants" placeholder={t("form.participantsPlaceholder")} className={INPUT} />
      </Field>
      {external && (
        <Field label={t(`form.externalId.${external}`)}>
          <input name="externalIds" dir="ltr" placeholder={t("form.externalIdPlaceholder")} className={INPUT} />
        </Field>
      )}
      <Field label={t("form.weight")}>
        <select name="weight" value={weight} onChange={(e) => setWeight(e.target.value as SourceWeightLike)} className={INPUT}>
          <option value="PRIMARY">{kind === "ANKORA_DOCUMENT" ? t("form.primaryConversation") : t("form.primary")}</option>
          <option value="SECONDARY">{t("form.secondary")}</option>
        </select>
      </Field>
      {weight === "SECONDARY" && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("form.secondaryHint")}</p>
      )}
      {weight === "PRIMARY" && kind === "ANKORA_DOCUMENT" && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("form.conversationHint")}</p>
      )}
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="topicsOnly" className="h-4 w-4 accent-gold" />
        {t("form.topicsOnly")}
      </label>
      <Field label={t("form.notes")}>
        <textarea name="notes" rows={2} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("form.submit")}
      </button>
    </form>
  );
}

function DomainForm({ clientId }: { clientId: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addClientDomainAction, close);
  const [kind, setKind] = useState<"CLIENT" | "PARTNER">("CLIENT");
  const t = useTranslations("clients.sources");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label={t("domains.domain")}>
        <input name="domain" required dir="ltr" placeholder="nux.ai" className={INPUT} />
      </Field>
      <Field label={t("domains.whose")}>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "CLIENT" | "PARTNER")} className={INPUT}>
          <option value="CLIENT">{t("domains.client")}</option>
          <option value="PARTNER">{t("domains.partnerOption")}</option>
        </select>
      </Field>
      {kind === "PARTNER" && (
        <>
          <Field label={t("domains.organization")}>
            <input name="organizationName" placeholder="Nextage" className={INPUT} />
          </Field>
          <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("domains.partnerHint")}</p>
        </>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("domains.submit")}
      </button>
    </form>
  );
}

function AnchorsForm({ clientId, anchors }: { clientId: string; anchors: PanelAnchors }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setClientSourceAnchorsAction, close);
  const t = useTranslations("clients.sources");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" data-testid="source-anchors-form">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label={t("anchors.keywordsLabel")}>
        <input name="keywords" defaultValue={anchors.keywords.join(", ")} placeholder={t("anchors.keywordsPlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("anchors.driveFolderLabel")}>
        <input name="driveFolder" dir="ltr" defaultValue={anchors.driveFolderId ?? ""} className={INPUT} />
      </Field>
      <Field label={t("anchors.conversationsDocLabel")}>
        <input name="conversationsDoc" dir="ltr" defaultValue={anchors.conversationsDocId ?? ""} className={INPUT} />
      </Field>
      <p className="-mt-1 text-[11px] text-app-text-tertiary">{t("anchors.hint")}</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}

/// "אושר מול הלקוח" on one source (21.10.2026): the items lowered only
/// because the source is Ankora's, confirmed in one step.
function ConfirmForm({ clientId, source, count }: { clientId: string; source: PanelSource; count: number }) {
  const close = useDrawerClose();
  const { showToast } = useToast();
  const t = useTranslations("clients.sources");
  const { onSubmit, pending, error } = useActionForm(confirmSourceWithClientAction, (r) => {
    showToast({ tone: "info", title: t("confirm.done"), description: t("confirm.doneDescription", { count: r.confirmed ?? 0, code: source.code }) });
    close();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" data-testid="source-confirm-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="code" value={source.code} />
      <p className="text-sm text-app-text-primary">{t("confirm.lead", { count, code: source.code })}</p>
      <p className="text-xs text-app-text-secondary">{t("confirm.effect", { code: source.code, label: t("clientConversation") })}</p>
      <Field label={t("confirm.note")}>
        <input name="note" required placeholder={t("confirm.notePlaceholder")} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("confirm.done")}
      </button>
    </form>
  );
}


/// `lowered`: per source code, the items uncertain only because the source
/// is Ankora's. `canConfirm`: a manager, who may confirm them with the
/// client in one step.
export function SourcesPanel({
  clientId,
  sources,
  domains,
  anchors,
  lowered = {},
  canConfirm = false,
}: {
  clientId: string;
  sources: PanelSource[];
  domains: PanelDomain[];
  anchors: PanelAnchors;
  lowered?: Record<string, number>;
  canConfirm?: boolean;
}) {
  const { showToast } = useToast();
  const t = useTranslations("clients.sources");
  const format = useFormatter();
  // A date-only value (its day in UTC), as the reader writes dates.
  const formatDate = (iso: string | null): string | null =>
    iso ? format.dateTime(new Date(`${iso.slice(0, 10)}T00:00:00Z`), { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }) : null;

  async function removeSource(s: PanelSource) {
    const result = await removeClientSourceAction(s.id, clientId);
    if (result.error) showToast({ tone: "error", title: t("toast.removeFailed"), description: result.error });
    else showToast({ tone: "info", title: t("toast.removedFromRegister"), description: `${s.code} ${s.title}` });
  }
  async function removeDomain(d: PanelDomain) {
    const result = await removeClientDomainAction(d.id, clientId);
    if (result.error) showToast({ tone: "error", title: t("toast.removeFailed"), description: result.error });
    else showToast({ tone: "info", title: t("toast.removed"), description: d.domain });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">{t("heading", { count: sources.length })}</h2>
          <Drawer triggerLabel={t("add")} title={t("addTitle")} variant="link">
            <SourceForm clientId={clientId} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-app-text-tertiary">{t("intro")}</p>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">{t("empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {sources.map((s) => (
              <li key={s.id} id={`source-${s.code}`} className="flex scroll-mt-24 flex-wrap items-start justify-between gap-3 rounded-lg py-3 target:bg-app-accent-soft">
                <div className="flex min-w-0 flex-[1_1_18rem] gap-3">
                  <span className="w-9 shrink-0 font-mono text-sm text-app-text-accent" dir="ltr">
                    {s.code}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text-primary" dir="auto">{s.title}</p>
                    <p className="text-xs text-app-text-secondary">
                      {[t(`kinds.${s.kind}`), formatDate(s.occurredAt), s.participants.join(", ") || null].filter(Boolean).join(" · ")}
                    </p>
                    {s.notes && <p className="mt-1 text-xs text-app-text-secondary" dir="auto">{s.notes}</p>}
                    {(s.weight === "SECONDARY" || s.topicsOnly || isClientConversation(s)) && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {s.weight === "SECONDARY" && <StatusBadge label={t("badges.secondary")} tone="gray" />}
                        {isClientConversation(s) && <StatusBadge label={t("clientConversation")} tone="green" />}
                        {s.topicsOnly && <StatusBadge label={t("badges.topicsOnly")} tone="amber" />}
                      </div>
                    )}
                    {(lowered[s.code] ?? 0) > 0 && (
                      <div className="mt-1.5 text-xs text-app-warning" data-testid="source-lowered">
                        {t("lowered", { count: lowered[s.code]! })}
                        {canConfirm && (
                          <span className="ms-2 inline-block">
                            <Drawer triggerLabel={t("confirm.done")} title={t("confirm.title", { code: s.code })} variant="link">
                              <ConfirmForm clientId={clientId} source={s} count={lowered[s.code]!} />
                            </Drawer>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => removeSource(s)} className="shrink-0 text-xs text-app-text-tertiary hover:text-app-error">
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">{t("domains.heading", { count: domains.length })}</h2>
          <Drawer triggerLabel={t("domains.add")} title={t("domains.addTitle")} variant="link">
            <DomainForm clientId={clientId} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-app-text-tertiary">{t("domains.intro")}</p>
        {domains.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">{t("domains.empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {domains.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <p className="text-sm text-app-text-primary">
                  <span dir="ltr">{d.domain}</span>
                  <span className="ms-2 text-xs text-app-text-secondary">
                    {d.kind === "CLIENT" ? t("domains.client") : d.organizationName ? t("domains.partnerOf", { name: d.organizationName }) : t("domains.partner")}
                  </span>
                </p>
                <button type="button" onClick={() => removeDomain(d)} className="shrink-0 text-xs text-app-text-tertiary hover:text-app-error">
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-6" data-testid="source-anchors">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">{t("anchors.heading")}</h2>
          <Drawer triggerLabel={t("anchors.edit")} title={t("anchors.title")} variant="link">
            <AnchorsForm clientId={clientId} anchors={anchors} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-app-text-tertiary">{t("anchors.intro")}</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="text-app-text-secondary">{t("anchors.keywords")}</dt>
            <dd className="text-app-text-primary">{anchors.keywords.length > 0 ? anchors.keywords.join(", ") : t("anchors.none")}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-app-text-secondary">{t("anchors.driveFolder")}</dt>
            <dd className="text-app-text-primary">
              {anchors.driveFolderId ? (
                <a href={`https://drive.google.com/drive/folders/${anchors.driveFolderId}`} target="_blank" rel="noreferrer" className="text-app-text-accent hover:underline">
                  {t("anchors.openInDrive")}
                </a>
              ) : (
                t("anchors.none")
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-app-text-secondary">{t("anchors.conversationsDoc")}</dt>
            <dd className="text-app-text-primary">
              {anchors.conversationsDocId ? (
                <a href={`https://docs.google.com/document/d/${anchors.conversationsDocId}/edit`} target="_blank" rel="noreferrer" className="text-app-text-accent hover:underline">
                  {t("anchors.openInDrive")}
                </a>
              ) : (
                t("anchors.none")
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
