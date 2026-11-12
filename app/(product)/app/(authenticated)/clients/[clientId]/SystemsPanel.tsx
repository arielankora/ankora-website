"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatMinor } from "@/lib/money";
import { type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  SYSTEM_ACCESS_STATUS_LABELS,
  SYSTEM_ACCESS_STATUS_TONE,
  SYSTEM_PERMISSION_LABELS,
  isAccessGap,
  type BillingCycleLike,
  type SystemAccessStatusLike,
  type SystemPermissionLike,
} from "@/lib/system-map";
import { addSystemAccessAction, updateSystemAccessAction, removeSystemAccessAction } from "../system-actions";
import { EntitySelect, Field, INPUT, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption, ItemExtras, ItemTags, AudienceField, MissingFields } from "./knowledge-ui";

// Org brain, phase 2: the system map, section 7.1 of the client file
// (claude/org-brain-spec-2026-10-12.md, 3.6).
//
// Read top down, it is the handover's to-do list: systems we are waiting
// for come first, then the ones we have no way into, then the rest. The
// vault keeps the secret; this keeps everything a person needs to know
// before they reach for it.

export type PanelSystem = {
  /// Spec 3.1: fields still missing, and the line that says so.
  missingFields?: string[];
  missingToResolve?: string | null;
  missing?: string | null;
  /// When a person last confirmed it, as ISO.
  verifiedAt?: string | null;
  /// Spec 3.1: the team's refs, as form text and as labels.
  externalRefs?: string;
  refs?: string[];
  clientVisible?: boolean;
  ownerId?: string | null;
  id: string;
  systemName: string;
  purpose: string | null;
  entityId: string | null;
  entityName: string | null;
  url: string | null;
  accountUsed: string | null;
  ourPermission: SystemPermissionLike;
  accessStatus: SystemAccessStatusLike;
  blocker: string | null;
  clientAdmin: string | null;
  credential: { id: string; systemName: string } | null;
  billingCycle: BillingCycleLike | null;
  billingCostMinor: number | null;
  billingCurrency: string | null;
  cardLast4: string | null;
  invoiceTo: string | null;
  notes: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  audience: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  audienceUserIds?: string[];
  doNotDisclose: string | null;
  sources: string[];
};

type VaultOption = { id: string; systemName: string };

function money(minor: number, currency: string | null) {
  return currency === "USD" ? `$${(minor / 100).toLocaleString("en-US")}` : formatMinor(minor);
}

function SystemForm({
  clientId,
  sourceOptions,
  vault,
  entities,
  existing,
}: {
  clientId: string;
  sourceOptions: SourceOption[];
  /// Null when this person may not open the vault: no picker at all.
  vault: VaultOption[] | null;
  entities: EntityOption[];
  existing?: PanelSystem;
}) {
  const t = useTranslations("clients.systems");
  const tStatus = useTranslations("clients.page.knowledgeStatus");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateSystemAccessAction : addSystemAccessAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.status ?? "CONFIRMED");
  const [access, setAccess] = useState<SystemAccessStatusLike>(existing?.accessStatus ?? "HAS_ACCESS");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label={t("system")}>
        <input name="systemName" required defaultValue={existing?.systemName ?? ""} placeholder="Mercury" className={INPUT} />
      </Field>
      <EntitySelect entities={entities} defaultValue={existing?.entityId} />
      <Field label={t("purpose")}>
        <input name="purpose" defaultValue={existing?.purpose ?? ""} placeholder={t("purposePlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("url")}>
        <input name="url" dir="ltr" defaultValue={existing?.url ?? ""} placeholder="app.mercury.com" className={INPUT} />
      </Field>
      <Field label={t("accountUsed")}>
        <input name="accountUsed" defaultValue={existing?.accountUsed ?? ""} placeholder="office@client.com" className={INPUT} />
      </Field>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("noPasswords")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("accessStatus")}>
          <select name="accessStatus" value={access} onChange={(e) => setAccess(e.target.value as SystemAccessStatusLike)} className={INPUT}>
            {(Object.keys(SYSTEM_ACCESS_STATUS_LABELS) as SystemAccessStatusLike[]).map((s) => (
              <option key={s} value={s}>
                {t(`access.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("ourPermission")}>
          <select name="ourPermission" defaultValue={existing?.ourPermission ?? "USER"} className={INPUT}>
            {(Object.keys(SYSTEM_PERMISSION_LABELS) as SystemPermissionLike[]).map((p) => (
              <option key={p} value={p}>
                {t(`permissions.${p}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {isAccessGap(access) && (
        <Field label={t("blocker")}>
          <input name="blocker" defaultValue={existing?.blocker ?? ""} placeholder={t("blockerPlaceholder")} className={INPUT} />
        </Field>
      )}
      <Field label={t("clientAdmin")}>
        <input name="clientAdmin" defaultValue={existing?.clientAdmin ?? ""} placeholder={t("clientAdminPlaceholder")} className={INPUT} />
      </Field>
      {vault && (
        <Field label={t("vaultEntry")}>
          <select name="credentialId" defaultValue={existing?.credential?.id ?? ""} className={INPUT}>
            <option value="">{t("none")}</option>
            {vault.map((v) => (
              <option key={v.id} value={v.id}>
                {v.systemName}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label={t("cost")}>
          <input
            name="billingCost"
            dir="ltr"
            inputMode="decimal"
            defaultValue={existing?.billingCostMinor != null ? String(existing.billingCostMinor / 100) : ""}
            className={INPUT}
          />
        </Field>
        <Field label={t("currency")}>
          <select name="billingCurrency" defaultValue={existing?.billingCurrency ?? "USD"} className={INPUT}>
            <option value="USD">$</option>
            <option value="ILS">₪</option>
          </select>
        </Field>
        <Field label={t("cycle")}>
          <select name="billingCycle" defaultValue={existing?.billingCycle ?? "MONTHLY"} className={INPUT}>
            <option value="MONTHLY">{t("cycles.MONTHLY")}</option>
            <option value="ANNUAL">{t("cycles.ANNUAL")}</option>
            <option value="OTHER">{t("cycles.OTHER")}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("cardLast4")}>
          <input name="cardLast4" dir="ltr" inputMode="numeric" maxLength={4} defaultValue={existing?.cardLast4 ?? ""} className={INPUT} />
        </Field>
        <Field label={t("invoiceTo")}>
          <input name="invoiceTo" dir="ltr" defaultValue={existing?.invoiceTo ?? ""} placeholder="billing@client.com" className={INPUT} />
        </Field>
      </div>
      <Field label={t("notes")}>
        <textarea name="notes" rows={2} defaultValue={existing?.notes ?? ""} className={INPUT} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("status")}>
          <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
            <option value="CONFIRMED">{tStatus("CONFIRMED")}</option>
            <option value="UNCERTAIN">{tStatus("UNCERTAIN")}</option>
            <option value="MISSING">{tStatus("MISSING")}</option>
          </select>
        </Field>
        <AudienceField existing={existing} />
      </div>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.status === "CONFIRMED"} />
      <MissingFields target="SYSTEM" existing={existing} />
      <ItemExtras existing={existing} />
      {status !== "CONFIRMED" && (
        <Field label={t("toResolve")}>
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      <Field label={t("doNotDisclose")}>
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : existing ? t("save") : t("add")}
      </button>
    </form>
  );
}

export function SystemsPanel({
  clientId,
  systems,
  sourceOptions,
  vault,
  entities,
  ruleWarnings = {},
}: {
  clientId: string;
  systems: PanelSystem[];
  sourceOptions: SourceOption[];
  vault: VaultOption[] | null;
  entities: EntityOption[];
  /// Where a client's rule disagrees with the system (R16), by system id.
  ruleWarnings?: Record<string, string[]>;
}) {
  const { showToast } = useToast();
  const t = useTranslations("clients.systems");
  const gaps = systems.filter((s) => isAccessGap(s.accessStatus)).length;

  async function remove(s: PanelSystem) {
    const result = await removeSystemAccessAction(s.id, clientId);
    if (result.error) showToast({ tone: "error", title: t("removeFailed"), description: result.error });
    else showToast({ tone: "info", title: t("removed"), description: s.systemName });
  }

  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-sm font-medium text-app-text-primary">
          {t("title", { count: systems.length })}
          {gaps > 0 && <span className="ms-2 text-xs font-normal text-app-warning">{t("gaps", { count: gaps })}</span>}
        </h2>
        <Drawer triggerLabel={t("addTrigger")} title={t("drawerTitle")} variant="link">
          <SystemForm clientId={clientId} sourceOptions={sourceOptions} vault={vault} entities={entities} />
        </Drawer>
      </div>
      {systems.length === 0 ? (
        <p className="mt-2 text-sm text-app-text-tertiary">{t("empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {systems.map((s) => (
            <li key={s.id} id={`item-${s.id}`} className="py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-[1_1_18rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <p dir="auto" className="text-sm font-medium text-app-text-primary">{s.systemName}</p>
                    <StatusBadge label={t(`access.${s.accessStatus}`)} tone={SYSTEM_ACCESS_STATUS_TONE[s.accessStatus]} />
                  </div>
                  <p className="text-xs text-app-text-secondary">
                    {[s.purpose, s.entityName, s.ourPermission !== "NONE" ? t("permissionLine", { permission: t(`permissions.${s.ourPermission}`) }) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {s.accountUsed && (
                    <p className="mt-1 text-xs text-app-text-secondary">
                      {t.rich("accountLine", { account: s.accountUsed, ltr: (chunks) => <span dir="ltr">{chunks}</span> })}
                    </p>
                  )}
                  {s.blocker && <p className="mt-1 text-xs text-app-warning">{t("blockerLine", { value: s.blocker })}</p>}
                  {s.clientAdmin && <p className="mt-1 text-xs text-app-text-secondary">{t("clientAdminLine", { value: s.clientAdmin })}</p>}
                  {s.billingCostMinor !== null && (
                    <p className="mt-1 text-xs text-app-text-secondary">
                      {money(s.billingCostMinor, s.billingCurrency)} {s.billingCycle && s.billingCycle !== "OTHER" ? t(`per.${s.billingCycle}`) : ""}
                      {s.cardLast4 && <span dir="ltr"> · ****{s.cardLast4}</span>}
                      {s.invoiceTo && (
                        <>
                          {" "}
                          · {t.rich("invoiceLine", { to: s.invoiceTo, ltr: (chunks) => <span dir="ltr">{chunks}</span> })}
                        </>
                      )}
                    </p>
                  )}
                  {s.notes && <p dir="auto" className="mt-1 text-xs text-app-text-secondary">{s.notes}</p>}
                  {s.credential && (
                    <p className="mt-1 text-xs">
                      <Link href={`/app/credentials?clientId=${clientId}`} className="text-app-text-accent hover:underline">
                        {t("inVault", { name: s.credential.systemName })}
                      </Link>
                    </p>
                  )}
                  {s.doNotDisclose && <p className="mt-1 text-xs text-app-error">{t("doNotDiscloseLine", { value: s.doNotDisclose })}</p>}
                  {(ruleWarnings[s.id] ?? []).map((w, i) => (
                    <p key={i} className="mt-1 text-xs text-app-warning">
                      {w}
                    </p>
                  ))}
                  <StatusLine status={s.status} toResolve={s.toResolve} />
                  <ItemTags item={s} />
                  <SourceCodes sources={s.sources} options={sourceOptions} />
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <Drawer triggerLabel={t("edit")} title={t("editTitle")} variant="link">
                    <SystemForm clientId={clientId} sourceOptions={sourceOptions} vault={vault} entities={entities} existing={s} />
                  </Drawer>
                  <button type="button" onClick={() => remove(s)} className="text-app-text-tertiary hover:text-app-error">
                    {t("remove")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
