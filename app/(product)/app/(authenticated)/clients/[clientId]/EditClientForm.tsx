"use client";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { updateClientAction } from "../actions";
import { useActionForm } from "@/components/app/useActionForm";
import { formatMinor } from "@/lib/money";
import type { Client } from "@prisma/client";
import { SUBPROCESSOR_NOTICE_VALUES } from "@/lib/subprocessor-notice";

function SubmitButton({ pending }: { pending: boolean }) {
  const t = useTranslations("clients.page.edit");
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? t("saving") : t("save")}
    </button>
  );
}

export function EditClientForm({
  client,
  staff,
  noticeDocuments = [],
  noticeCheckedByName = null,
}: {
  client: Client;
  /// Portal phase 2: who can be this client's account manager. Ankora
  /// staff only - a client user on that list would end up named as the
  /// person to talk to on their own portal.
  staff: { id: string; name: string }[];
  /// 3.11.2026: the client's filed documents, to cite the contract behind
  /// the sub-processor notice answer. Contracts first.
  noticeDocuments?: { id: string; title: string }[];
  /// Who last set the sub-processor notice answer, by name.
  noticeCheckedByName?: string | null;
}) {
  const t = useTranslations("clients.page.edit");
  const locale = useLocale();
  const tNotice = useTranslations("clients.subprocessors.notice");
  const format = useFormatter();
  const { onSubmit, pending, error, ok } = useActionForm(updateClientAction);
  const noticeDate = (d: Date) => format.dateTime(new Date(d), { day: "numeric", month: "numeric", year: "numeric" });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="clientId" value={client.id} />
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("name")}</label>
        <input
          name="name"
          defaultValue={client.name}
          required
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("legalName")}</label>
        <input
          name="legalName"
          defaultValue={client.legalName ?? ""}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("primaryContact")}</label>
        <input
          name="primaryContact"
          defaultValue={client.primaryContact ?? ""}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("timezone")}</label>
        <input
          name="timezone"
          defaultValue={client.timezone}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("status")}</label>
        <select
          name="status"
          defaultValue={client.status}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="ACTIVE">{t("statuses.ACTIVE")}</option>
          <option value="PAUSED">{t("statuses.PAUSED")}</option>
          <option value="ARCHIVED">{t("statuses.ARCHIVED")}</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("kind")}</label>
        <select
          name="kind"
          defaultValue={client.kind}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="BUSINESS">{t("kinds.BUSINESS")}</option>
          <option value="PRIVATE">{t("kinds.PRIVATE")}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("industry")}</label>
        <input
          name="industry"
          defaultValue={client.industry ?? ""}
          placeholder={t("industryPlaceholder")}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      {/* 12.11.2026 (ADR 0006): the language emails, reports and alerts are
          written in for this client's people who have no account. */}
      <div>
        <label className="block text-xs font-medium text-app-text-secondary" htmlFor="communicationLocale">
          {t("communicationLocale")}
        </label>
        <select
          id="communicationLocale"
          name="communicationLocale"
          defaultValue={client.communicationLocale}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="he">{t("communicationLocales.he")}</option>
          <option value="en">{t("communicationLocales.en")}</option>
        </select>
        <span className="mt-1 block text-[11px] text-app-text-tertiary">{t("communicationLocaleHint")}</span>
      </div>

      <label className="flex items-start gap-3 sm:col-span-2">
        <input
          type="checkbox"
          name="isInternal"
          defaultChecked={client.isInternal}
          className="mt-0.5 h-4 w-4 shrink-0 accent-app-text-primary"
        />
        <span>
          <span className="block text-sm text-app-text-primary">{t("internal")}</span>
          <span className="block text-[11px] text-app-text-tertiary">
            {t("internalHint")}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 sm:col-span-2">
        <input
          type="checkbox"
          name="aiExcluded"
          defaultChecked={client.aiExcluded}
          className="mt-0.5 h-4 w-4 shrink-0 accent-app-text-primary"
        />
        <span>
          <span className="block text-sm text-app-text-primary">{t("aiExcluded")}</span>
          <span className="block text-[11px] text-app-text-tertiary">
            {t("aiExcludedHint")}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 sm:col-span-2">
        <input
          type="checkbox"
          name="procedureApprovalSeparation"
          defaultChecked={client.procedureApprovalSeparation}
          className="mt-0.5 h-4 w-4 shrink-0 accent-app-text-primary"
        />
        <span>
          <span className="block text-sm text-app-text-primary">{t("separation")}</span>
          <span className="block text-[11px] text-app-text-tertiary">
            {t("separationHint")}
          </span>
        </span>
      </label>

      {/* 14.11.2026 (processes redesign, stage 4, "Document.dc.html"): the
          client is audited. A switch, as the board draws it. */}
      <label id="audit-requirements" className="flex scroll-mt-24 items-center justify-between gap-4 rounded-[14px] border border-app-border bg-white px-5 py-4 sm:col-span-2" data-testid="audit-requirements">
        <span>
          <span className="block text-base font-bold text-app-text-primary">{t("auditRequirements")}</span>
          <span className="block text-sm text-app-text-secondary">{t("auditRequirementsHint")}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          name="auditRequirements"
          defaultChecked={client.auditRequirements}
          className="relative h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-app-border-strong transition-colors before:absolute before:start-[3px] before:top-[3px] before:h-[22px] before:w-[22px] before:rounded-full before:bg-white before:transition-transform checked:bg-app-success checked:before:translate-x-5 rtl:checked:before:-translate-x-5"
        />
      </label>

      {/* 3.11.2026: P8 step 8. Whether this client's own contract commits
          Ankora to tell it by email about a new sub-processor. Internal:
          the client does not see it on the portal. */}
      <div className="rounded-lg border border-app-border bg-cream-dim/40 p-4 sm:col-span-2">
        <p className="text-xs font-medium text-app-text-primary">{t("notice.title")}</p>
        <p className="mt-1 text-[11px] text-app-text-tertiary">
          {t("notice.hint")}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("notice.state")}</span>
            <select
              name="subprocessorNotice"
              defaultValue={client.subprocessorNotice}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            >
              {SUBPROCESSOR_NOTICE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {tNotice(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("notice.source")}</span>
            <input
              name="subprocessorNoticeSource"
              defaultValue={client.subprocessorNoticeSource ?? ""}
              placeholder={t("notice.sourcePlaceholder")}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
            <span className="mt-1 block text-[11px] text-app-text-tertiary">{t("notice.sourceHint")}</span>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("notice.document")}</span>
            <select
              name="subprocessorNoticeDocumentId"
              defaultValue={client.subprocessorNoticeDocumentId ?? ""}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            >
              <option value="">{t("notice.noDocument")}</option>
              {noticeDocuments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-app-text-tertiary">{t("notice.optional")}</span>
          </label>
        </div>
        {client.subprocessorNoticeCheckedAt && (
          <p className="mt-3 text-[11px] text-app-text-tertiary">
            {noticeCheckedByName
              ? t("notice.updatedBy", { date: noticeDate(client.subprocessorNoticeCheckedAt), name: noticeCheckedByName })
              : t("notice.updated", { date: noticeDate(client.subprocessorNoticeCheckedAt) })}
          </p>
        )}
      </div>

      {/* Portal phase 2. Three fields that only matter because of the
          portal, grouped so they read as one subject rather than as more
          client settings. */}
      <div className="rounded-lg border border-app-border bg-cream-dim/40 p-4 sm:col-span-2">
        <p className="text-xs font-medium text-app-text-primary">{t("portal.title")}</p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("portal.manager")}</span>
            <select
              name="accountManagerId"
              defaultValue={client.accountManagerId ?? ""}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            >
              <option value="">{t("portal.noManager")}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-app-text-tertiary">{t("portal.managerHint")}</span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("portal.whatsapp")}</span>
            <input
              name="whatsappNumber"
              dir="ltr"
              defaultValue={client.whatsappNumber ?? ""}
              placeholder="052-000-0000"
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-end text-sm text-app-text-primary outline-none focus:border-gold"
            />
            <span className="mt-1 block text-[11px] text-app-text-tertiary">
              {t("portal.whatsappHint")}
            </span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{t("portal.ceiling")}</span>
            <input
              name="approvalCeiling"
              dir="ltr"
              inputMode="decimal"
              defaultValue={client.approvalCeilingMinor !== null ? String(client.approvalCeilingMinor / 100) : ""}
              placeholder="500"
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-end text-sm text-app-text-primary outline-none focus:border-gold"
            />
            <span className="mt-1 block text-[11px] text-app-text-tertiary">
              {client.approvalCeilingMinor !== null
                ? t("portal.ceilingNow", { amount: formatMinor(client.approvalCeilingMinor, locale) ?? "" })
                : t("portal.ceilingEmpty")}
            </span>
          </label>
        </div>
      </div>

      {/* Portal phase 3. The same three answers the client sees on their
          own screen, editable here because half of what is worth
          recording is said on a call and never typed by the person who
          said it. Changing one here does not send the client a
          notification - the notice goes the other way, to the account
          manager, when the CLIENT edits. */}
      <div className="sm:col-span-2">
        <p className="text-xs font-medium text-app-text-secondary">{t("preferences.title")}</p>
        <p className="mt-1 text-[11px] text-app-text-tertiary">
          {t("preferences.hint")}
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="block text-[11px] text-app-text-secondary">{t("preferences.contact")}</span>
            <textarea
              name="preferenceContact"
              rows={2}
              defaultValue={client.preferenceContact ?? ""}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-app-text-secondary">{t("preferences.matters")}</span>
            <textarea
              name="preferenceMatters"
              rows={2}
              defaultValue={client.preferenceMatters ?? ""}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-app-text-secondary">{t("preferences.never")}</span>
            <textarea
              name="preferenceNever"
              rows={2}
              defaultValue={client.preferenceNever ?? ""}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:col-span-2">
        {error && <p className="text-sm text-app-error">{error}</p>}
        {ok && <p className="text-sm text-app-success">{t("saved")}</p>}
        <div className="ms-auto">
          <SubmitButton pending={pending} />
        </div>
      </div>
    </form>
  );
}
