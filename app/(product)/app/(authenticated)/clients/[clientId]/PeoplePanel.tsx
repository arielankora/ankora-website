"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMinor } from "@/lib/money";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import type { KnowledgeStatusLike } from "@/lib/knowledge";
import { EntitySelect, Field, INPUT, SourceCodes, SourcesField, StatusLine, type EntityOption, type SourceOption, ItemExtras, ItemTags, AudienceField, MissingFields, useItemStaff } from "./knowledge-ui";
import {
  addClientContactAction,
  updateClientContactAction,
  removeClientContactAction,
  addClientOrganizationAction,
  updateClientOrganizationAction,
  removeClientOrganizationAction,
} from "../people-actions";

// Org brain, phase 2: sections 3 ("אנשים ויחסים") and 7.2 ("ספקים ונותני
// שירות") of the client file (claude/org-brain-spec-2026-10-12.md, 3.5).
//
// The list reads like Hadas's table: who, what they are to the client, how
// to reach them, and what to know before you do. A status other than
// "confirmed" is shown on the row, with what would close it, because a
// question mark nobody can see is a question nobody answers.

type Relationship = "CLIENT_STAFF" | "PROVIDER" | "ADVISOR" | "INVESTOR" | "SUPPLIER" | "ANKORA";

const RELATIONSHIPS: Relationship[] = ["CLIENT_STAFF", "PROVIDER", "ADVISOR", "INVESTOR", "SUPPLIER", "ANKORA"];

export type { SourceOption };

export type PanelContact = {
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
  name: string | null;
  role: string | null;
  relationship: Relationship;
  organizationName: string | null;
  entityId: string | null;
  entityName: string | null;
  emails: string[];
  phones: string[];
  context: string | null;
  channelOrder: string[];
  isPrimary: boolean;
  isDecisionMaker: boolean;
  clientSideAddress: string | null;
  /// 14.11.2026 (stage 3, spec 4.6): the day they left, "YYYY-MM-DD".
  endedAt?: string | null;
  /// Ankora people only: their user in the product.
  userId?: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  audience: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  audienceUserIds?: string[];
  doNotDisclose: string | null;
  sensitive: boolean;
  /// Formatted refs: ["S1 08:13", "S3"].
  sources: string[];
};

export type PanelOrganization = {
  /// When a person last confirmed it, as ISO.
  verifiedAt?: string | null;
  /// Spec 3.1: the team's refs, as form text and as labels.
  externalRefs?: string;
  refs?: string[];
  audience?: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  audienceUserIds?: string[];
  clientVisible?: boolean;
  doNotDisclose?: string | null;
  ownerId?: string | null;
  id: string;
  name: string;
  domains: string[];
  role: string | null;
  relationship: Relationship;
  monthlyCostMinor: number | null;
  currency: string | null;
  notes: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  sources: string[];
};

function ContactForm({
  clientId,
  organizationNames,
  sourceOptions,
  entities,
  existing,
}: {
  clientId: string;
  organizationNames: string[];
  sourceOptions: SourceOption[];
  entities: EntityOption[];
  existing?: PanelContact;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateClientContactAction : addClientContactAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.status ?? "CONFIRMED");
  const [relationship, setRelationship] = useState<Relationship>(existing?.relationship ?? "CLIENT_STAFF");
  const staff = useItemStaff();
  const t = useTranslations("clients.people");
  const tk = useTranslations("clients.knowledge");

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("contact.name")}>
          <input name="name" defaultValue={existing?.name ?? ""} className={INPUT} />
        </Field>
        <Field label={t("contact.role")}>
          <input name="role" defaultValue={existing?.role ?? ""} placeholder="VP Finance" className={INPUT} />
        </Field>
      </div>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("contact.nameOrRole")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("contact.relationship")}>
          <select name="relationship" value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)} className={INPUT}>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {t(`relationships.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        {!existing && (
          <Field label={t("contact.organization")}>
            <input name="organizationName" list="people-org-names" placeholder="Nextage" className={INPUT} />
            <datalist id="people-org-names">
              {organizationNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
        )}
      </div>
      <EntitySelect entities={entities} defaultValue={existing?.entityId} />
      <Field label={t("contact.emails")}>
        <input name="emails" dir="ltr" defaultValue={existing?.emails.join(", ") ?? ""} placeholder="name@company.com" className={INPUT} />
      </Field>
      <Field label={t("contact.phones")}>
        <input name="phones" dir="ltr" defaultValue={existing?.phones.join(", ") ?? ""} placeholder="054-1234567" className={INPUT} />
      </Field>
      {existing && (existing.emails.length > 0 || existing.phones.length > 0) && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("contact.sharedDetails")}</p>
      )}
      <Field label={t("contact.channelOrder")}>
        <input name="channelOrder" defaultValue={existing?.channelOrder.join(", ") ?? ""} placeholder={t("contact.channelOrderPlaceholder")} className={INPUT} />
      </Field>
      <Field label={t("contact.context")}>
        <textarea name="context" rows={2} defaultValue={existing?.context ?? ""} className={INPUT} />
      </Field>
      {relationship === "ANKORA" && (
        <>
          <Field label={t("contact.user")}>
            <select name="userId" defaultValue={existing?.userId ?? ""} className={INPUT}>
              <option value="">{t("contact.noUser")}</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("contact.clientSideAddress")}>
            <input name="clientSideAddress" dir="ltr" defaultValue={existing?.clientSideAddress ?? ""} placeholder="office@client.com" className={INPUT} />
          </Field>
        </>
      )}
      {existing && (
        <Field label={t("contact.endedAt")}>
          <input type="date" name="endedAt" defaultValue={existing.endedAt ?? ""} className={INPUT} />
        </Field>
      )}
      <div className="flex flex-wrap gap-4 text-sm text-app-text-primary">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPrimary" defaultChecked={existing?.isPrimary} className="h-4 w-4 accent-gold" />
          {t("contact.isPrimary")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isDecisionMaker" defaultChecked={existing?.isDecisionMaker} className="h-4 w-4 accent-gold" />
          {t("contact.isDecisionMaker")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="sensitive" defaultChecked={existing?.sensitive} className="h-4 w-4 accent-gold" />
          {t("contact.sensitive")}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={tk("statusLabel")}>
          <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
            <option value="CONFIRMED">{tk("status.CONFIRMED")}</option>
            <option value="UNCERTAIN">{tk("status.UNCERTAIN")}</option>
            <option value="MISSING">{tk("status.MISSING")}</option>
          </select>
        </Field>
        <AudienceField existing={existing} />
      </div>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.status === "CONFIRMED"} />
      <MissingFields target="CONTACT" existing={existing} />
      <ItemExtras existing={existing} />
      {status !== "CONFIRMED" && (
        <Field label={tk("toResolve")}>
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} placeholder={t("contact.toResolvePlaceholder")} className={INPUT} />
        </Field>
      )}
      <Field label={tk("doNotDisclose")}>
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} placeholder={tk("extras.doNotDisclosePlaceholder")} className={INPUT} />
      </Field>

      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : existing ? t("save") : t("addToFile")}
      </button>
    </form>
  );
}

function OrganizationForm({
  clientId,
  organizationNames,
  sourceOptions,
  existing,
}: {
  clientId: string;
  organizationNames: string[];
  sourceOptions: SourceOption[];
  existing?: PanelOrganization;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateClientOrganizationAction : addClientOrganizationAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.status ?? "CONFIRMED");
  const t = useTranslations("clients.people");
  const tk = useTranslations("clients.knowledge");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label={existing ? t("organization.nameShared") : t("organization.name")}>
        <input name="name" required={!existing} readOnly={!!existing} defaultValue={existing?.name ?? ""} list="org-form-names" placeholder="Nextage" className={INPUT} />
        <datalist id="org-form-names">
          {organizationNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label={t("organization.domain")}>
        <input name="domains" dir="ltr" defaultValue={existing?.domains.join(", ") ?? ""} placeholder="nextage.co.il" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("organization.role")}>
          <input name="role" defaultValue={existing?.role ?? ""} placeholder={t("organization.rolePlaceholder")} className={INPUT} />
        </Field>
        <Field label={t("organization.kind")}>
          <select name="relationship" defaultValue={existing?.relationship ?? "PROVIDER"} className={INPUT}>
            <option value="PROVIDER">{t("relationships.PROVIDER")}</option>
            <option value="ADVISOR">{t("relationships.ADVISOR")}</option>
            <option value="SUPPLIER">{t("relationships.SUPPLIER")}</option>
            <option value="INVESTOR">{t("relationships.INVESTOR")}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("organization.monthlyCost")}>
          <input name="monthlyCost" dir="ltr" inputMode="decimal" defaultValue={existing?.monthlyCostMinor != null ? String(existing.monthlyCostMinor / 100) : ""} placeholder="22000" className={INPUT} />
        </Field>
        <Field label={t("organization.currency")}>
          <select name="currency" defaultValue={existing?.currency ?? "ILS"} className={INPUT}>
            <option value="ILS">₪</option>
            <option value="USD">$</option>
          </select>
        </Field>
      </div>
      <Field label={t("organization.notes")}>
        <textarea name="notes" rows={2} defaultValue={existing?.notes ?? ""} className={INPUT} />
      </Field>
      <Field label={tk("statusLabel")}>
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{tk("status.CONFIRMED")}</option>
          <option value="UNCERTAIN">{tk("status.UNCERTAIN")}</option>
          <option value="MISSING">{tk("status.MISSING")}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.status === "CONFIRMED"} />
      <ItemExtras existing={existing} disclose audience />
      {status !== "CONFIRMED" && (
        <Field label={tk("toResolve")}>
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : existing ? t("save") : t("addToFile")}
      </button>
    </form>
  );
}

export function PeoplePanel({
  clientId,
  contacts,
  organizations,
  organizationNames,
  sourceOptions,
  entities,
}: {
  clientId: string;
  contacts: PanelContact[];
  organizations: PanelOrganization[];
  organizationNames: string[];
  sourceOptions: SourceOption[];
  entities: EntityOption[];
}) {
  const { showToast } = useToast();
  const t = useTranslations("clients.people");
  const locale = useLocale();

  async function removeContact(c: PanelContact) {
    const result = await removeClientContactAction(c.id, clientId);
    if (result.error) showToast({ tone: "error", title: t("toast.removeFailed"), description: result.error });
    else showToast({ tone: "info", title: t("toast.removed"), description: c.name ?? c.role ?? "" });
  }
  async function removeOrganization(o: PanelOrganization) {
    const result = await removeClientOrganizationAction(o.id, clientId);
    if (result.error) showToast({ tone: "error", title: t("toast.removeFailed"), description: result.error });
    else showToast({ tone: "info", title: t("toast.removed"), description: o.name });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">{t("contacts.heading", { count: contacts.length })}</h2>
          <Drawer triggerLabel={t("contacts.add")} title={t("contacts.addTitle")} variant="link">
            <ContactForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} entities={entities} />
          </Drawer>
        </div>
        {contacts.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">{t("contacts.empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {contacts.map((c) => (
              <li key={c.id} id={`item-${c.id}`} className="py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-[1_1_18rem]">
                    <p className="text-sm font-medium text-app-text-primary">
                      <span dir="auto">{c.name ?? c.role}</span>
                      {c.isPrimary && <span className="ms-2 text-xs font-normal text-app-text-accent">{t("contacts.primary")}</span>}
                      {c.isDecisionMaker && <span className="ms-2 text-xs font-normal text-app-text-accent">{t("contact.isDecisionMaker")}</span>}
                    </p>
                    <p className="text-xs text-app-text-secondary">
                      {[c.name ? c.role : null, t(`relationships.${c.relationship}`), c.organizationName, c.entityName].filter(Boolean).join(" · ")}
                    </p>
                    {c.endedAt && (
                      <p className="text-xs font-bold text-app-error" data-testid="contact-ended">
                        {t("contact.endedOn", { date: c.endedAt.split("-").reverse().join(".") })}
                      </p>
                    )}
                    {(c.emails.length > 0 || c.phones.length > 0 || c.clientSideAddress) && (
                      <p className="mt-1 text-xs text-app-text-secondary" dir="ltr">
                        {[...c.emails, ...c.phones, c.clientSideAddress].filter(Boolean).join("  ·  ")}
                      </p>
                    )}
                    {c.context && <p className="mt-1 text-xs text-app-text-secondary" dir="auto">{c.context}</p>}
                    {c.channelOrder.length > 0 && <p className="mt-1 text-xs text-app-text-tertiary">{t("contacts.channels", { channels: c.channelOrder.join(", ") })}</p>}
                    {c.doNotDisclose && <p className="mt-1 text-xs text-app-error">{t("doNotTell", { text: c.doNotDisclose })}</p>}
                    <StatusLine status={c.status} toResolve={c.toResolve} />
                    <ItemTags item={c} missingTarget="CONTACT" />
                    <SourceCodes sources={c.sources} options={sourceOptions} />
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <Drawer triggerLabel={t("edit")} title={t("contacts.editTitle")} variant="link">
                      <ContactForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} entities={entities} existing={c} />
                    </Drawer>
                    <button type="button" onClick={() => removeContact(c)} className="text-app-text-tertiary hover:text-app-error">
                      {t("remove")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">{t("organizations.heading", { count: organizations.length })}</h2>
          <Drawer triggerLabel={t("organizations.add")} title={t("organizations.addTitle")} variant="link">
            <OrganizationForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} />
          </Drawer>
        </div>
        {organizations.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">{t("organizations.empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {organizations.map((o) => (
              <li key={o.id} id={`item-${o.id}`} className="flex flex-wrap items-start justify-between gap-3 py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
                <div className="min-w-0 flex-[1_1_18rem]">
                  <p className="text-sm font-medium text-app-text-primary" dir="auto">{o.name}</p>
                  <p className="text-xs text-app-text-secondary">
                    {[o.role, t(`relationships.${o.relationship}`), o.domains.join(", ") || null].filter(Boolean).join(" · ")}
                  </p>
                  {o.monthlyCostMinor !== null && (
                    <p className="mt-1 text-xs text-app-text-secondary">
                      {t("organizations.perMonth", {
                        // As before: the amount reads the same in either language.
                        amount: o.currency === "USD" ? `$${(o.monthlyCostMinor / 100).toLocaleString("en-US")}` : formatMinor(o.monthlyCostMinor, locale) ?? "",
                      })}
                    </p>
                  )}
                  {o.notes && <p className="mt-1 text-xs text-app-text-secondary" dir="auto">{o.notes}</p>}
                  <StatusLine status={o.status} toResolve={o.toResolve} />
                  <ItemTags item={o} disclose />
                  <SourceCodes sources={o.sources} options={sourceOptions} />
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Drawer triggerLabel={t("edit")} title={t("organizations.editTitle", { name: o.name })} variant="link">
                    <OrganizationForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} existing={o} />
                  </Drawer>
                  <button type="button" onClick={() => removeOrganization(o)} className="text-xs text-app-text-tertiary hover:text-app-error">
                    {t("remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
