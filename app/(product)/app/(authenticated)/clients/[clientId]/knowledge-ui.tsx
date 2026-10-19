"use client";
import { createContext, useContext, useState } from "react";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_AUDIENCE_LABELS, KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";

// The pieces every section of the client file draws the same way: the
// form field, the status line with what would close it, and the sources.
// Shared so people, organizations and systems cannot drift apart.

export type SourceOption = { code: string; title: string };
export type EntityOption = { id: string; name: string };

export const STATUS_TONE: Record<KnowledgeStatusLike, "green" | "amber" | "gray" | "red"> = {
  CONFIRMED: "green",
  UNCERTAIN: "amber",
  MISSING: "red",
  SUPERSEDED: "gray",
};

export const INPUT = "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";
export const LABEL = "block text-xs font-medium text-appNavy/60";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

/// The item's sources, as typed codes, with the register right under the
/// field so nobody has to remember what S4 was.
export function SourcesField({ options, defaultValue, status }: { options: SourceOption[]; defaultValue?: string; status: KnowledgeStatusLike }) {
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

export function SourceCodes({ sources, options }: { sources: string[]; options: SourceOption[] }) {
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

export function StatusLine({ status, toResolve }: { status: KnowledgeStatusLike; toResolve: string | null }) {
  if (status === "CONFIRMED") return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-appNavy/60">
      <StatusBadge label={KNOWLEDGE_STATUS_LABELS[status]} tone={STATUS_TONE[status]} />
      {toResolve && <span>{toResolve}</span>}
    </div>
  );
}

/// Which of the client's legal entities. Shown only once the client has
/// entities: before that there is nothing to choose.
export function EntitySelect({ entities, defaultValue }: { entities: EntityOption[]; defaultValue?: string | null }) {
  if (entities.length === 0) return null;
  return (
    <Field label="ישות">
      <select name="entityId" defaultValue={defaultValue ?? ""} className={INPUT}>
        <option value="">לא משויך לישות</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Spec 3.1: who keeps an item right, and whether the client sees it. The
// same two fields on every kind of item, so the staff list is given once.
// ---------------------------------------------------------------------------

export type StaffOption = { id: string; name: string };
const StaffContext = createContext<StaffOption[]>([]);

export function ItemStaffProvider({ staff, children }: { staff: StaffOption[]; children: React.ReactNode }) {
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}

/// The two fields in an item's form. `owner` false for a process, whose
/// form already asks for its owner.
export function ItemExtras({
  existing,
  owner = true,
  disclose = false,
  audience = false,
}: {
  existing?: {
    clientVisible?: boolean;
    ownerId?: string | null;
    doNotDisclose?: string | null;
    externalRefs?: string;
    audience?: Audience;
    audienceUserIds?: string[];
  } | null;
  owner?: boolean;
  /// Spec 3.1, 6.1: "not to tell", for the forms that have no field of their own.
  disclose?: boolean;
  /// Spec 3.1: who sees it, for the forms that have no field of their own.
  audience?: boolean;
}) {
  const staff = useContext(StaffContext);
  return (
    <div className="grid grid-cols-2 gap-3">
      <input type="hidden" name="itemExtras" value="1" />
      {audience && (
        <>
          <input type="hidden" name="itemAudience" value="1" />
          <AudienceField existing={existing} />
        </>
      )}
      <div className="col-span-2">
        <Field label="הפניות חיצוניות (RAID-002, ClickUp:86c1x)">
          <input name="externalRefs" defaultValue={existing?.externalRefs ?? ""} placeholder="RAID-002, HND-014" className={INPUT} dir="ltr" />
        </Field>
      </div>
      {disclose && (
        <div className="col-span-2">
          <input type="hidden" name="itemDisclose" value="1" />
          <Field label="לא לספר (למי, ועד מתי)">
            <input name="doNotDisclose" defaultValue={existing?.doNotDisclose ?? ""} placeholder="עובדי הלקוח, עד הודעה של המנכ״ל" className={INPUT} />
          </Field>
        </div>
      )}
      {owner && (
        <Field label="בעלים באנקורה">
          <select name="itemOwnerId" defaultValue={existing?.ownerId ?? ""} className={INPUT}>
            <option value="">בלי בעלים</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-appNavy">
        <input type="checkbox" name="clientVisible" defaultChecked={!!existing?.clientVisible} className="h-4 w-4 accent-gold" />
        גלוי ללקוח
      </label>
    </div>
  );
}

/// The two, as a line on the item. Nothing when neither is set.
export function ItemTags({
  item,
  disclose = false,
}: {
  item: { clientVisible?: boolean; ownerId?: string | null; doNotDisclose?: string | null; refs?: string[]; verifiedAt?: string | null };
  disclose?: boolean;
}) {
  const staff = useContext(StaffContext);
  const owner = item.ownerId ? staff.find((u) => u.id === item.ownerId)?.name : null;
  const notToTell = disclose ? item.doNotDisclose?.trim() : null;
  const refs = item.refs ?? [];
  if (!item.clientVisible && !owner && !notToTell && refs.length === 0 && !item.verifiedAt) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-appNavy/60" data-testid="item-tags">
      {refs.map((r) => (
        <span key={r} dir="ltr" className="rounded border border-lineDark px-1.5 py-0.5 font-jbmono text-[11px]" data-testid="external-ref">
          {r}
        </span>
      ))}
      {item.verifiedAt && <span>אומת: {new Date(item.verifiedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}</span>}
      {notToTell && <span className="w-full text-red-700" data-testid="do-not-disclose">לא לספר: {notToTell}</span>}
      {item.clientVisible && <StatusBadge label="גלוי ללקוח" tone="green" />}
      {owner && <span>בעלים: {owner}</span>}
    </div>
  );
}

type Audience = keyof typeof KNOWLEDGE_AUDIENCE_LABELS;

/// Spec 3.1: who sees the item. "Restricted" and "account team" name the
/// people on it; whoever saves it is added on the server, so nobody locks
/// themselves out of what they wrote.
export function AudienceField({ existing }: { existing?: { audience?: Audience; audienceUserIds?: string[] } | null }) {
  const staff = useContext(StaffContext);
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? "ALL_STAFF");
  const chosen = new Set(existing?.audienceUserIds ?? []);
  return (
    <>
      <Field label="מי רואה">
        <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={INPUT}>
          {(Object.keys(KNOWLEDGE_AUDIENCE_LABELS) as Audience[]).map((a) => (
            <option key={a} value={a}>
              {KNOWLEDGE_AUDIENCE_LABELS[a]}
            </option>
          ))}
        </select>
      </Field>
      {audience !== "ALL_STAFF" && staff.length > 0 && (
        <fieldset className="col-span-2" data-testid="audience-people">
          <input type="hidden" name="audiencePeople" value="1" />
          <legend className={LABEL}>{audience === "RESTRICTED" ? "רק האנשים האלה רואים" : "מנהל התיק, ובנוסף"}</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {staff.map((u) => (
              <label key={u.id} className="flex items-center gap-1.5 text-sm text-appNavy">
                <input type="checkbox" name="audienceUserIds" value={u.id} defaultChecked={chosen.has(u.id)} className="h-4 w-4 accent-gold" />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
