"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import {
  CLIENT_CONVERSATION_LABEL,
  SOURCE_KIND_LABELS,
  SOURCE_WEIGHT_LABELS,
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

const EXTERNAL_LABEL: Partial<Record<SourceKindLike, string>> = {
  TRANSCRIPT: "מזהה Fireflies",
  CLIENT_DOCUMENT: "מזהה מסמך בתיק",
  ANKORA_DOCUMENT: "מזהה מסמך בתיק",
  TASK: "מזהה משימה",
};

function SourceForm({ clientId }: { clientId: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addClientSourceAction, close);
  const [kind, setKind] = useState<SourceKindLike>("TRANSCRIPT");
  const [weight, setWeight] = useState<SourceWeightLike>("PRIMARY");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="סוג">
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
                {SOURCE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="תאריך">
          <input name="occurredAt" type="date" dir="ltr" className={INPUT} />
        </Field>
      </div>
      <Field label="שם *">
        <input name="title" required placeholder="פגישת היכרות עם Nextage" className={INPUT} />
      </Field>
      <Field label="משתתפים">
        <input name="participants" placeholder="אורן, שני, הדס" className={INPUT} />
      </Field>
      {EXTERNAL_LABEL[kind] && (
        <Field label={EXTERNAL_LABEL[kind]!}>
          <input name="externalIds" dir="ltr" placeholder="אפשר כמה, מופרדים בפסיק" className={INPUT} />
        </Field>
      )}
      <Field label="משקל">
        <select name="weight" value={weight} onChange={(e) => setWeight(e.target.value as SourceWeightLike)} className={INPUT}>
          <option value="PRIMARY">
            {SOURCE_WEIGHT_LABELS.PRIMARY}: {kind === "ANKORA_DOCUMENT" ? `${CLIENT_CONVERSATION_LABEL}, מה שהלקוח אמר בכתב של אנקורה` : "הלקוח או ספק שלו"}
          </option>
          <option value="SECONDARY">{SOURCE_WEIGHT_LABELS.SECONDARY}: מסמך שאנקורה כתבה</option>
        </select>
      </Field>
      {weight === "SECONDARY" && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">פריט שכל המקורות שלו משניים נשמר כ&quot;לא ודאי&quot;, עד שהלקוח מאשר.</p>
      )}
      {weight === "PRIMARY" && kind === "ANKORA_DOCUMENT" && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">למסמך שאנקורה כתבה מתוך שיחה עם הלקוח, כמו סיכום פגישת היכרות. מה שנכנס ממנו לא יסומן &quot;לא ודאי&quot; רק בגלל שהוא בכתב של אנקורה.</p>
      )}
      <label className="flex items-center gap-2 text-sm text-app-text-primary">
        <input type="checkbox" name="topicsOnly" className="h-4 w-4 accent-gold" />
        נושאים בלבד: בלי ציטוטים ובלי פרטים
      </label>
      <Field label="הערות">
        <textarea name="notes" rows={2} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "הוספה למרשם"}
      </button>
    </form>
  );
}

function DomainForm({ clientId }: { clientId: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(addClientDomainAction, close);
  const [kind, setKind] = useState<"CLIENT" | "PARTNER">("CLIENT");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="דומיין *">
        <input name="domain" required dir="ltr" placeholder="nux.ai" className={INPUT} />
      </Field>
      <Field label="של מי">
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "CLIENT" | "PARTNER")} className={INPUT}>
          <option value="CLIENT">של הלקוח</option>
          <option value="PARTNER">של שותף או נותן שירות</option>
        </select>
      </Field>
      {kind === "PARTNER" && (
        <>
          <Field label="ארגון">
            <input name="organizationName" placeholder="Nextage" className={INPUT} />
          </Field>
          <p className="-mt-2 text-[11px] text-app-text-tertiary">שותף יכול לעבוד עם כמה לקוחות, ולכן הדומיין שלו לבד לא משייך מייל ללקוח.</p>
        </>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "הוספה"}
      </button>
    </form>
  );
}

function AnchorsForm({ clientId, anchors }: { clientId: string; anchors: PanelAnchors }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(setClientSourceAnchorsAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" data-testid="source-anchors-form">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="מילות מפתח בכותרת פגישה או מייל">
        <input name="keywords" defaultValue={anchors.keywords.join(", ")} placeholder="nux, נוקס" className={INPUT} />
      </Field>
      <Field label="תיקיית השיחות בדרייב (קישור או מזהה)">
        <input name="driveFolder" dir="ltr" defaultValue={anchors.driveFolderId ?? ""} className={INPUT} />
      </Field>
      <Field label="המסמך המצטבר של השיחות (קישור או מזהה)">
        <input name="conversationsDoc" dir="ltr" defaultValue={anchors.conversationsDocId ?? ""} className={INPUT} />
      </Field>
      <p className="-mt-1 text-[11px] text-app-text-tertiary">אלה אומרים לקלוד איפה לחפש, לא מה מותר לו. מה שכל עובד יכול לקרוא נקבע לפי החיבורים שלו.</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "שמירה"}
      </button>
    </form>
  );
}

/// "אושר מול הלקוח" on one source (21.10.2026): the items lowered only
/// because the source is Ankora's, confirmed in one step.
function ConfirmForm({ clientId, source, count }: { clientId: string; source: PanelSource; count: number }) {
  const close = useDrawerClose();
  const { showToast } = useToast();
  const { onSubmit, pending, error } = useActionForm(confirmSourceWithClientAction, (r) => {
    showToast({ tone: "info", title: "אושר מול הלקוח", description: `${r.confirmed ?? 0} פריטים מ-${source.code}` });
    close();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" data-testid="source-confirm-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="code" value={source.code} />
      <p className="text-sm text-app-text-primary">
        {count === 1 ? "פריט אחד מסומן" : `${count} פריטים מסומנים`} &quot;לא ודאי&quot; רק כי המקור שלהם, {source.code}, הוא מסמך של אנקורה.
      </p>
      <p className="text-xs text-app-text-secondary">
        באישור הם יסומנו כמאושרים, ו-{source.code} יסומן &quot;{CLIENT_CONVERSATION_LABEL}&quot;, כך שמה שייכנס ממנו בהמשך לא יסומן שוב. פריט שלא ודאי מסיבה אחרת לא משתנה.
      </p>
      <Field label="איך זה אושר מול הלקוח, בשורה אחת *">
        <input name="note" required placeholder="נדב עבר על הרשימה בוואטסאפ ב-21.10 ואישר" className={INPUT} />
      </Field>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "אושר מול הלקוח"}
      </button>
    </form>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
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

  async function removeSource(s: PanelSource) {
    const result = await removeClientSourceAction(s.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר מהמרשם", description: `${s.code} ${s.title}` });
  }
  async function removeDomain(d: PanelDomain) {
    const result = await removeClientDomainAction(d.id, clientId);
    if (result.error) showToast({ tone: "error", title: "ההסרה נכשלה", description: result.error });
    else showToast({ tone: "info", title: "הוסר", description: d.domain });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">מרשם מקורות ({sources.length})</h2>
          <Drawer triggerLabel="+ מקור" title="מקור חדש במרשם" variant="link">
            <SourceForm clientId={clientId} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-app-text-tertiary">כל פריט בתיק מציין מאיפה הוא ידוע, לפי הקודים כאן.</p>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">אין עדיין מקורות. מוסיפים את הפגישה או המסמך הראשון, ואז אפשר לציין אותם ליד כל פריט.</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {sources.map((s) => (
              <li key={s.id} id={`source-${s.code}`} className="flex scroll-mt-24 flex-wrap items-start justify-between gap-3 rounded-lg py-3 target:bg-app-accent-soft">
                <div className="flex min-w-0 flex-[1_1_18rem] gap-3">
                  <span className="w-9 shrink-0 font-mono text-sm text-app-text-accent" dir="ltr">
                    {s.code}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text-primary">{s.title}</p>
                    <p className="text-xs text-app-text-secondary">
                      {[SOURCE_KIND_LABELS[s.kind], formatDate(s.occurredAt), s.participants.join(", ") || null].filter(Boolean).join(" · ")}
                    </p>
                    {s.notes && <p className="mt-1 text-xs text-app-text-secondary">{s.notes}</p>}
                    {(s.weight === "SECONDARY" || s.topicsOnly || isClientConversation(s)) && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {s.weight === "SECONDARY" && <StatusBadge label="משני" tone="gray" />}
                        {isClientConversation(s) && <StatusBadge label={CLIENT_CONVERSATION_LABEL} tone="green" />}
                        {s.topicsOnly && <StatusBadge label="נושאים בלבד" tone="amber" />}
                      </div>
                    )}
                    {(lowered[s.code] ?? 0) > 0 && (
                      <div className="mt-1.5 text-xs text-app-warning" data-testid="source-lowered">
                        {lowered[s.code] === 1 ? "פריט אחד לא ודאי" : `${lowered[s.code]} פריטים לא ודאיים`} רק כי זה מסמך של אנקורה.
                        {canConfirm && (
                          <span className="ms-2 inline-block">
                            <Drawer triggerLabel="אושר מול הלקוח" title={`אישור מול הלקוח: ${s.code}`} variant="link">
                              <ConfirmForm clientId={clientId} source={s} count={lowered[s.code]!} />
                            </Drawer>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => removeSource(s)} className="shrink-0 text-xs text-app-text-tertiary hover:text-app-error">
                  הסרה
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">דומיינים ({domains.length})</h2>
          <Drawer triggerLabel="+ דומיין" title="דומיין בתיק" variant="link">
            <DomainForm clientId={clientId} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-app-text-tertiary">כך מייל או הקלטה משויכים ללקוח הנכון.</p>
        {domains.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">אין עדיין דומיינים.</p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border">
            {domains.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <p className="text-sm text-app-text-primary">
                  <span dir="ltr">{d.domain}</span>
                  <span className="ms-2 text-xs text-app-text-secondary">
                    {d.kind === "CLIENT" ? "של הלקוח" : `שותף${d.organizationName ? `: ${d.organizationName}` : ""}`}
                  </span>
                </p>
                <button type="button" onClick={() => removeDomain(d)} className="shrink-0 text-xs text-app-text-tertiary hover:text-app-error">
                  הסרה
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-app-border bg-white p-6" data-testid="source-anchors">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-app-text-primary">איפה עוד מחפשים</h2>
          <Drawer triggerLabel="עריכה" title="עוגנים למקורות" variant="link">
            <AnchorsForm clientId={clientId} anchors={anchors} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-app-text-tertiary">יחד עם הדומיינים, כך &quot;קדם עם קלוד&quot; מוצא מיילים, קבצים והקלטות של הלקוח.</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="text-app-text-secondary">מילות מפתח:</dt>
            <dd className="text-app-text-primary">{anchors.keywords.length > 0 ? anchors.keywords.join(", ") : "אין"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-app-text-secondary">תיקיית שיחות:</dt>
            <dd className="text-app-text-primary">
              {anchors.driveFolderId ? (
                <a href={`https://drive.google.com/drive/folders/${anchors.driveFolderId}`} target="_blank" rel="noreferrer" className="text-app-text-accent hover:underline">
                  פתיחה בדרייב
                </a>
              ) : (
                "אין"
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-app-text-secondary">מסמך מצטבר:</dt>
            <dd className="text-app-text-primary">
              {anchors.conversationsDocId ? (
                <a href={`https://docs.google.com/document/d/${anchors.conversationsDocId}/edit`} target="_blank" rel="noreferrer" className="text-app-text-accent hover:underline">
                  פתיחה בדרייב
                </a>
              ) : (
                "אין"
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
