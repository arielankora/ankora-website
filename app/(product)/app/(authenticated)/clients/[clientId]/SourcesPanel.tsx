"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import {
  SOURCE_KIND_LABELS,
  SOURCE_WEIGHT_LABELS,
  defaultWeight,
  type SourceKindLike,
  type SourceWeightLike,
} from "@/lib/knowledge-sources";
import {
  addClientSourceAction,
  removeClientSourceAction,
  addClientDomainAction,
  removeClientDomainAction,
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

export type PanelDomain = {
  id: string;
  domain: string;
  kind: "CLIENT" | "PARTNER";
  organizationName: string | null;
};

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
          <option value="PRIMARY">{SOURCE_WEIGHT_LABELS.PRIMARY}: הלקוח או ספק שלו</option>
          <option value="SECONDARY">{SOURCE_WEIGHT_LABELS.SECONDARY}: מסמך שאנקורה כתבה</option>
        </select>
      </Field>
      {weight === "SECONDARY" && (
        <p className="-mt-2 text-[11px] text-appNavy/40">פריט שכל המקורות שלו משניים נשמר כ&quot;לא ודאי&quot;, עד שהלקוח מאשר.</p>
      )}
      <label className="flex items-center gap-2 text-sm text-appNavy">
        <input type="checkbox" name="topicsOnly" className="h-4 w-4 accent-gold" />
        נושאים בלבד: בלי ציטוטים ובלי פרטים
      </label>
      <Field label="הערות">
        <textarea name="notes" rows={2} className={INPUT} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
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
          <p className="-mt-2 text-[11px] text-appNavy/40">שותף יכול לעבוד עם כמה לקוחות, ולכן הדומיין שלו לבד לא משייך מייל ללקוח.</p>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "הוספה"}
      </button>
    </form>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}

export function SourcesPanel({ clientId, sources, domains }: { clientId: string; sources: PanelSource[]; domains: PanelDomain[] }) {
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
      <div className="rounded-2xl border border-lineDark bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-appNavy">מרשם מקורות ({sources.length})</h2>
          <Drawer triggerLabel="+ מקור" title="מקור חדש במרשם" variant="link">
            <SourceForm clientId={clientId} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-appNavy/50">כל פריט בתיק מציין מאיפה הוא ידוע, לפי הקודים כאן.</p>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-appNavy/50">אין עדיין מקורות. מוסיפים את הפגישה או המסמך הראשון, ואז אפשר לציין אותם ליד כל פריט.</p>
        ) : (
          <ul className="mt-4 divide-y divide-lineDark">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 gap-3">
                  <span className="w-9 shrink-0 font-mono text-sm text-gold-dim" dir="ltr">
                    {s.code}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-appNavy">{s.title}</p>
                    <p className="text-xs text-appNavy/60">
                      {[SOURCE_KIND_LABELS[s.kind], formatDate(s.occurredAt), s.participants.join(", ") || null].filter(Boolean).join(" · ")}
                    </p>
                    {s.notes && <p className="mt-1 text-xs text-appNavy/70">{s.notes}</p>}
                    {(s.weight === "SECONDARY" || s.topicsOnly) && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {s.weight === "SECONDARY" && <StatusBadge label="משני" tone="gray" />}
                        {s.topicsOnly && <StatusBadge label="נושאים בלבד" tone="amber" />}
                      </div>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => removeSource(s)} className="shrink-0 text-xs text-appNavy/50 hover:text-red-600">
                  הסרה
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-lineDark bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-sm font-medium text-appNavy">דומיינים ({domains.length})</h2>
          <Drawer triggerLabel="+ דומיין" title="דומיין בתיק" variant="link">
            <DomainForm clientId={clientId} />
          </Drawer>
        </div>
        <p className="mt-1 text-xs text-appNavy/50">כך מייל או הקלטה משויכים ללקוח הנכון.</p>
        {domains.length === 0 ? (
          <p className="mt-2 text-sm text-appNavy/50">אין עדיין דומיינים.</p>
        ) : (
          <ul className="mt-4 divide-y divide-lineDark">
            {domains.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <p className="text-sm text-appNavy">
                  <span dir="ltr">{d.domain}</span>
                  <span className="ms-2 text-xs text-appNavy/60">
                    {d.kind === "CLIENT" ? "של הלקוח" : `שותף${d.organizationName ? `: ${d.organizationName}` : ""}`}
                  </span>
                </p>
                <button type="button" onClick={() => removeDomain(d)} className="shrink-0 text-xs text-appNavy/50 hover:text-red-600">
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
