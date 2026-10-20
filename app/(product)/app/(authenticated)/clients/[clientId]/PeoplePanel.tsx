"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { formatMinor } from "@/lib/money";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_AUDIENCE_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
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

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  CLIENT_STAFF: "צוות הלקוח",
  PROVIDER: "נותן שירות",
  ADVISOR: "יועץ",
  INVESTOR: "משקיע",
  SUPPLIER: "ספק",
  ANKORA: "אנקורה",
};

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

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="שם">
          <input name="name" defaultValue={existing?.name ?? ""} className={INPUT} />
        </Field>
        <Field label="תפקיד">
          <input name="role" defaultValue={existing?.role ?? ""} placeholder="VP Finance" className={INPUT} />
        </Field>
      </div>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">שם או תפקיד, לפחות אחד מהם.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="קשר ללקוח">
          <select name="relationship" value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)} className={INPUT}>
            {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {!existing && (
          <Field label="ארגון">
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
      <Field label="מיילים">
        <input name="emails" dir="ltr" defaultValue={existing?.emails.join(", ") ?? ""} placeholder="name@company.com" className={INPUT} />
      </Field>
      <Field label="טלפונים">
        <input name="phones" dir="ltr" defaultValue={existing?.phones.join(", ") ?? ""} placeholder="054-1234567" className={INPUT} />
      </Field>
      {existing && (existing.emails.length > 0 || existing.phones.length > 0) && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">מייל וטלפון שייכים לאדם, ומתעדכנים בכל תיק שהוא מופיע בו.</p>
      )}
      <Field label="ערוצים לפי סדר עדיפות">
        <input name="channelOrder" defaultValue={existing?.channelOrder.join(", ") ?? ""} placeholder="WhatsApp, Slack, מייל" className={INPUT} />
      </Field>
      <Field label="מה צריך לדעת כדי לעבוד איתו">
        <textarea name="context" rows={2} defaultValue={existing?.context ?? ""} className={INPUT} />
      </Field>
      {relationship === "ANKORA" && (
        <>
          <Field label="המשתמש שלו במערכת">
            <select name="userId" defaultValue={existing?.userId ?? ""} className={INPUT}>
              <option value="">לא מקושר</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="הכתובת שלו אצל הלקוח">
            <input name="clientSideAddress" dir="ltr" defaultValue={existing?.clientSideAddress ?? ""} placeholder="office@client.com" className={INPUT} />
          </Field>
        </>
      )}
      <div className="flex flex-wrap gap-4 text-sm text-app-text-primary">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPrimary" defaultChecked={existing?.isPrimary} className="h-4 w-4 accent-gold" />
          איש קשר ראשי
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isDecisionMaker" defaultChecked={existing?.isDecisionMaker} className="h-4 w-4 accent-gold" />
          מקבל החלטות
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="sensitive" defaultChecked={existing?.sensitive} className="h-4 w-4 accent-gold" />
          רגיש (לא עובר ל-Claude)
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="סטטוס">
          <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
            <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
            <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
            <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
          </select>
        </Field>
        <AudienceField existing={existing} />
      </div>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.status === "CONFIRMED"} />
      <MissingFields target="CONTACT" existing={existing} />
      <ItemExtras existing={existing} />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} placeholder="לבקש מגיא את המייל" className={INPUT} />
        </Field>
      )}
      <Field label="למי אסור לספר">
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} placeholder="עובדי הלקוח, עד הודעה של המנכ״ל" className={INPUT} />
      </Field>

      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה לתיק"}
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
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <Field label={existing ? "שם הארגון (משותף לכל אנקורה, לא נערך כאן)" : "שם הארגון *"}>
        <input name="name" required={!existing} readOnly={!!existing} defaultValue={existing?.name ?? ""} list="org-form-names" placeholder="Nextage" className={INPUT} />
        <datalist id="org-form-names">
          {organizationNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label="דומיין">
        <input name="domains" dir="ltr" defaultValue={existing?.domains.join(", ") ?? ""} placeholder="nextage.co.il" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="מה הוא ללקוח">
          <input name="role" defaultValue={existing?.role ?? ""} placeholder="הנהלת חשבונות ושכר" className={INPUT} />
        </Field>
        <Field label="סוג">
          <select name="relationship" defaultValue={existing?.relationship ?? "PROVIDER"} className={INPUT}>
            <option value="PROVIDER">{RELATIONSHIP_LABELS.PROVIDER}</option>
            <option value="ADVISOR">{RELATIONSHIP_LABELS.ADVISOR}</option>
            <option value="SUPPLIER">{RELATIONSHIP_LABELS.SUPPLIER}</option>
            <option value="INVESTOR">{RELATIONSHIP_LABELS.INVESTOR}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="עלות חודשית">
          <input name="monthlyCost" dir="ltr" inputMode="decimal" defaultValue={existing?.monthlyCostMinor != null ? String(existing.monthlyCostMinor / 100) : ""} placeholder="22000" className={INPUT} />
        </Field>
        <Field label="מטבע">
          <select name="currency" defaultValue={existing?.currency ?? "ILS"} className={INPUT}>
            <option value="ILS">₪</option>
            <option value="USD">$</option>
          </select>
        </Field>
      </div>
      <Field label="הערות">
        <textarea name="notes" rows={2} defaultValue={existing?.notes ?? ""} className={INPUT} />
      </Field>
      <Field label="סטטוס">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} confirmedBefore={existing?.status === "CONFIRMED"} />
      <ItemExtras existing={existing} disclose audience />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה לתיק"}
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

  async function removeContact(c: PanelContact) {
    const result = await removeClientContactAction(c.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר מהתיק", description: c.name ?? c.role ?? "" });
  }
  async function removeOrganization(o: PanelOrganization) {
    const result = await removeClientOrganizationAction(o.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר מהתיק", description: o.name });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">אנשים ויחסים ({contacts.length})</h2>
          <Drawer triggerLabel="+ איש קשר" title="איש קשר בתיק" variant="link">
            <ContactForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} entities={entities} />
          </Drawer>
        </div>
        {contacts.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">אין עדיין אנשי קשר בתיק.</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {contacts.map((c) => (
              <li key={c.id} id={`item-${c.id}`} className="py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text-primary">
                      {c.name ?? c.role}
                      {c.isPrimary && <span className="ms-2 text-xs font-normal text-app-text-accent">ראשי</span>}
                      {c.isDecisionMaker && <span className="ms-2 text-xs font-normal text-app-text-accent">מקבל החלטות</span>}
                    </p>
                    <p className="text-xs text-app-text-secondary">
                      {[c.name ? c.role : null, RELATIONSHIP_LABELS[c.relationship], c.organizationName, c.entityName].filter(Boolean).join(" · ")}
                    </p>
                    {(c.emails.length > 0 || c.phones.length > 0 || c.clientSideAddress) && (
                      <p className="mt-1 text-xs text-app-text-secondary" dir="ltr">
                        {[...c.emails, ...c.phones, c.clientSideAddress].filter(Boolean).join("  ·  ")}
                      </p>
                    )}
                    {c.context && <p className="mt-1 text-xs text-app-text-secondary">{c.context}</p>}
                    {c.channelOrder.length > 0 && <p className="mt-1 text-xs text-app-text-tertiary">ערוצים: {c.channelOrder.join(", ")}</p>}
                    {c.doNotDisclose && <p className="mt-1 text-xs text-app-error">לא לספר: {c.doNotDisclose}</p>}
                    <StatusLine status={c.status} toResolve={c.toResolve} />
                    <ItemTags item={c} />
                    <SourceCodes sources={c.sources} options={sourceOptions} />
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <Drawer triggerLabel="עריכה" title="עריכת איש קשר" variant="link">
                      <ContactForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} entities={entities} existing={c} />
                    </Drawer>
                    <button type="button" onClick={() => removeContact(c)} className="text-app-text-tertiary hover:text-app-error">
                      הסרה
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
          <h2 className="text-sm font-medium text-app-text-primary">ספקים ונותני שירות ({organizations.length})</h2>
          <Drawer triggerLabel="+ ארגון" title="ארגון בתיק" variant="link">
            <OrganizationForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} />
          </Drawer>
        </div>
        {organizations.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">אין עדיין ספקים או נותני שירות קבועים בתיק.</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {organizations.map((o) => (
              <li key={o.id} id={`item-${o.id}`} className="flex flex-wrap items-start justify-between gap-3 py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-app-text-primary">{o.name}</p>
                  <p className="text-xs text-app-text-secondary">
                    {[o.role, RELATIONSHIP_LABELS[o.relationship], o.domains.join(", ") || null].filter(Boolean).join(" · ")}
                  </p>
                  {o.monthlyCostMinor !== null && (
                    <p className="mt-1 text-xs text-app-text-secondary">
                      {o.currency === "USD" ? `$${(o.monthlyCostMinor / 100).toLocaleString("en-US")}` : formatMinor(o.monthlyCostMinor)} בחודש
                    </p>
                  )}
                  {o.notes && <p className="mt-1 text-xs text-app-text-secondary">{o.notes}</p>}
                  <StatusLine status={o.status} toResolve={o.toResolve} />
                  <ItemTags item={o} disclose />
                  <SourceCodes sources={o.sources} options={sourceOptions} />
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Drawer triggerLabel="עריכה" title={`עריכת ${o.name}`} variant="link">
                    <OrganizationForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} existing={o} />
                  </Drawer>
                  <button type="button" onClick={() => removeOrganization(o)} className="text-xs text-app-text-tertiary hover:text-app-error">
                    הסרה
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
