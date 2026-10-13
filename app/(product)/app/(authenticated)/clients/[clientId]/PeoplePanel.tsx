"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatMinor } from "@/lib/money";
import { KNOWLEDGE_STATUS_LABELS, KNOWLEDGE_AUDIENCE_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import {
  addClientContactAction,
  updateClientContactAction,
  removeClientContactAction,
  addClientOrganizationAction,
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

const STATUS_TONE: Record<KnowledgeStatusLike, "green" | "amber" | "gray" | "red"> = {
  CONFIRMED: "green",
  UNCERTAIN: "amber",
  MISSING: "red",
  SUPERSEDED: "gray",
};

export type PanelContact = {
  id: string;
  name: string | null;
  role: string | null;
  relationship: Relationship;
  organizationName: string | null;
  entityLabel: string | null;
  emails: string[];
  phones: string[];
  context: string | null;
  channelOrder: string[];
  isPrimary: boolean;
  isDecisionMaker: boolean;
  clientSideAddress: string | null;
  status: KnowledgeStatusLike;
  toResolve: string | null;
  audience: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED";
  doNotDisclose: string | null;
  sensitive: boolean;
  /// Formatted refs: ["S1 08:13", "S3"].
  sources: string[];
};

export type PanelOrganization = {
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

export type SourceOption = { code: string; title: string };

const INPUT = "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";
const LABEL = "block text-xs font-medium text-appNavy/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/// The item's sources, as typed codes, with the register right under the
/// field so nobody has to remember what S4 was.
function SourcesField({ options, defaultValue, status }: { options: SourceOption[]; defaultValue?: string; status: KnowledgeStatusLike }) {
  return (
    <div>
      <Field label={status === "MISSING" ? "מקורות" : "מקורות *"}>
        <input name="sources" dir="ltr" defaultValue={defaultValue ?? ""} placeholder="S1 08:13, S3" className={INPUT} />
      </Field>
      {options.length === 0 ? (
        <p className="mt-1 text-[11px] text-appNavy/40">אין עדיין מקורות במרשם. מוסיפים אותם ב&quot;מרשם מקורות&quot; במסך הלקוח.</p>
      ) : (
        // The most recent ones: a long register is read in its own panel.
        <p className="mt-1 text-[11px] text-appNavy/40">
          {options
            .slice(-8)
            .map((o) => `${o.code} ${o.title}`)
            .join(" · ")}
          {options.length > 8 && " · ..."}
        </p>
      )}
    </div>
  );
}

function SourceCodes({ sources, options }: { sources: string[]; options: SourceOption[] }) {
  if (sources.length === 0) return null;
  const titles = new Map(options.map((o) => [o.code, o.title]));
  return (
    <p className="mt-1 text-[11px] text-appNavy/45" dir="ltr">
      {sources.map((s, i) => (
        <span key={s} title={titles.get(s.split(" ")[0])}>
          {i > 0 && ", "}
          {s}
        </span>
      ))}
    </p>
  );
}

function ContactForm({
  clientId,
  organizationNames,
  sourceOptions,
  existing,
}: {
  clientId: string;
  organizationNames: string[];
  sourceOptions: SourceOption[];
  existing?: PanelContact;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateClientContactAction : addClientContactAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>(existing?.status ?? "CONFIRMED");
  const [relationship, setRelationship] = useState<Relationship>(existing?.relationship ?? "CLIENT_STAFF");

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
      <p className="-mt-2 text-[11px] text-appNavy/40">שם או תפקיד, לפחות אחד מהם.</p>
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
        {existing && (
          <Field label="ישות">
            <input name="entityLabel" defaultValue={existing.entityLabel ?? ""} placeholder="Inc / LTD" className={INPUT} />
          </Field>
        )}
      </div>
      {!existing && (
        <Field label="ישות">
          <input name="entityLabel" placeholder="Inc / LTD" className={INPUT} />
        </Field>
      )}
      <Field label="מיילים">
        <input name="emails" dir="ltr" defaultValue={existing?.emails.join(", ") ?? ""} placeholder="name@company.com" className={INPUT} />
      </Field>
      <Field label="טלפונים">
        <input name="phones" dir="ltr" defaultValue={existing?.phones.join(", ") ?? ""} placeholder="054-1234567" className={INPUT} />
      </Field>
      {existing && (existing.emails.length > 0 || existing.phones.length > 0) && (
        <p className="-mt-2 text-[11px] text-appNavy/40">מייל וטלפון שייכים לאדם, ומתעדכנים בכל תיק שהוא מופיע בו.</p>
      )}
      <Field label="ערוצים לפי סדר עדיפות">
        <input name="channelOrder" defaultValue={existing?.channelOrder.join(", ") ?? ""} placeholder="WhatsApp, Slack, מייל" className={INPUT} />
      </Field>
      <Field label="מה צריך לדעת כדי לעבוד איתו">
        <textarea name="context" rows={2} defaultValue={existing?.context ?? ""} className={INPUT} />
      </Field>
      {relationship === "ANKORA" && (
        <Field label="הכתובת שלו אצל הלקוח">
          <input name="clientSideAddress" dir="ltr" defaultValue={existing?.clientSideAddress ?? ""} placeholder="office@client.com" className={INPUT} />
        </Field>
      )}
      <div className="flex flex-wrap gap-4 text-sm text-appNavy">
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
        <Field label="מי רואה">
          <select name="audience" defaultValue={existing?.audience ?? "ALL_STAFF"} className={INPUT}>
            {(Object.keys(KNOWLEDGE_AUDIENCE_LABELS) as (keyof typeof KNOWLEDGE_AUDIENCE_LABELS)[]).map((a) => (
              <option key={a} value={a}>
                {KNOWLEDGE_AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <SourcesField options={sourceOptions} defaultValue={existing?.sources.join(", ")} status={status} />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required defaultValue={existing?.toResolve ?? ""} placeholder="לבקש מגיא את המייל" className={INPUT} />
        </Field>
      )}
      <Field label="למי אסור לספר">
        <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} placeholder="עובדי הלקוח, עד הודעה של המנכ״ל" className={INPUT} />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : existing ? "שמירה" : "הוספה לתיק"}
      </button>
    </form>
  );
}

function OrganizationForm({
  clientId,
  organizationNames,
  sourceOptions,
}: {
  clientId: string;
  organizationNames: string[];
  sourceOptions: SourceOption[];
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addClientOrganizationAction, close);
  const [status, setStatus] = useState<KnowledgeStatusLike>("CONFIRMED");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="שם הארגון *">
        <input name="name" required list="org-form-names" placeholder="Nextage" className={INPUT} />
        <datalist id="org-form-names">
          {organizationNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label="דומיין">
        <input name="domains" dir="ltr" placeholder="nextage.co.il" className={INPUT} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="מה הוא ללקוח">
          <input name="role" placeholder="הנהלת חשבונות ושכר" className={INPUT} />
        </Field>
        <Field label="סוג">
          <select name="relationship" defaultValue="PROVIDER" className={INPUT}>
            <option value="PROVIDER">{RELATIONSHIP_LABELS.PROVIDER}</option>
            <option value="ADVISOR">{RELATIONSHIP_LABELS.ADVISOR}</option>
            <option value="SUPPLIER">{RELATIONSHIP_LABELS.SUPPLIER}</option>
            <option value="INVESTOR">{RELATIONSHIP_LABELS.INVESTOR}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="עלות חודשית">
          <input name="monthlyCost" dir="ltr" inputMode="decimal" placeholder="22000" className={INPUT} />
        </Field>
        <Field label="מטבע">
          <select name="currency" defaultValue="ILS" className={INPUT}>
            <option value="ILS">₪</option>
            <option value="USD">$</option>
          </select>
        </Field>
      </div>
      <Field label="הערות">
        <textarea name="notes" rows={2} className={INPUT} />
      </Field>
      <Field label="סטטוס">
        <select name="knowledgeStatus" value={status} onChange={(e) => setStatus(e.target.value as KnowledgeStatusLike)} className={INPUT}>
          <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
          <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
          <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
        </select>
      </Field>
      <SourcesField options={sourceOptions} status={status} />
      {status !== "CONFIRMED" && (
        <Field label="מה יסגור את זה *">
          <input name="toResolve" required className={INPUT} />
        </Field>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "הוספה לתיק"}
      </button>
    </form>
  );
}

function StatusLine({ status, toResolve }: { status: KnowledgeStatusLike; toResolve: string | null }) {
  if (status === "CONFIRMED") return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-appNavy/60">
      <StatusBadge label={KNOWLEDGE_STATUS_LABELS[status]} tone={STATUS_TONE[status]} />
      {toResolve && <span>{toResolve}</span>}
    </div>
  );
}

export function PeoplePanel({
  clientId,
  contacts,
  organizations,
  organizationNames,
  sourceOptions,
}: {
  clientId: string;
  contacts: PanelContact[];
  organizations: PanelOrganization[];
  organizationNames: string[];
  sourceOptions: SourceOption[];
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
      <div className="rounded-2xl border border-lineDark bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-appNavy">אנשים ויחסים ({contacts.length})</h2>
          <Drawer triggerLabel="+ איש קשר" title="איש קשר בתיק" variant="link">
            <ContactForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} />
          </Drawer>
        </div>
        {contacts.length === 0 ? (
          <p className="mt-2 text-sm text-appNavy/50">אין עדיין אנשי קשר בתיק.</p>
        ) : (
          <ul className="mt-4 divide-y divide-lineDark">
            {contacts.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-appNavy">
                      {c.name ?? c.role}
                      {c.isPrimary && <span className="ms-2 text-xs font-normal text-gold-dim">ראשי</span>}
                      {c.isDecisionMaker && <span className="ms-2 text-xs font-normal text-gold-dim">מקבל החלטות</span>}
                    </p>
                    <p className="text-xs text-appNavy/60">
                      {[c.name ? c.role : null, RELATIONSHIP_LABELS[c.relationship], c.organizationName, c.entityLabel].filter(Boolean).join(" · ")}
                    </p>
                    {(c.emails.length > 0 || c.phones.length > 0 || c.clientSideAddress) && (
                      <p className="mt-1 text-xs text-appNavy/70" dir="ltr">
                        {[...c.emails, ...c.phones, c.clientSideAddress].filter(Boolean).join("  ·  ")}
                      </p>
                    )}
                    {c.context && <p className="mt-1 text-xs text-appNavy/70">{c.context}</p>}
                    {c.channelOrder.length > 0 && <p className="mt-1 text-xs text-appNavy/50">ערוצים: {c.channelOrder.join(", ")}</p>}
                    {c.doNotDisclose && <p className="mt-1 text-xs text-red-700">לא לספר: {c.doNotDisclose}</p>}
                    <StatusLine status={c.status} toResolve={c.toResolve} />
                    <SourceCodes sources={c.sources} options={sourceOptions} />
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <Drawer triggerLabel="עריכה" title="עריכת איש קשר" variant="link">
                      <ContactForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} existing={c} />
                    </Drawer>
                    <button type="button" onClick={() => removeContact(c)} className="text-appNavy/50 hover:text-red-600">
                      הסרה
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-lineDark bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-appNavy">ספקים ונותני שירות ({organizations.length})</h2>
          <Drawer triggerLabel="+ ארגון" title="ארגון בתיק" variant="link">
            <OrganizationForm clientId={clientId} organizationNames={organizationNames} sourceOptions={sourceOptions} />
          </Drawer>
        </div>
        {organizations.length === 0 ? (
          <p className="mt-2 text-sm text-appNavy/50">אין עדיין ספקים או נותני שירות קבועים בתיק.</p>
        ) : (
          <ul className="mt-4 divide-y divide-lineDark">
            {organizations.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-appNavy">{o.name}</p>
                  <p className="text-xs text-appNavy/60">
                    {[o.role, RELATIONSHIP_LABELS[o.relationship], o.domains.join(", ") || null].filter(Boolean).join(" · ")}
                  </p>
                  {o.monthlyCostMinor !== null && (
                    <p className="mt-1 text-xs text-appNavy/70">
                      {o.currency === "USD" ? `$${(o.monthlyCostMinor / 100).toLocaleString("en-US")}` : formatMinor(o.monthlyCostMinor)} בחודש
                    </p>
                  )}
                  {o.notes && <p className="mt-1 text-xs text-appNavy/70">{o.notes}</p>}
                  <StatusLine status={o.status} toResolve={o.toResolve} />
                  <SourceCodes sources={o.sources} options={sourceOptions} />
                </div>
                <button type="button" onClick={() => removeOrganization(o)} className="shrink-0 text-xs text-appNavy/50 hover:text-red-600">
                  הסרה
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
