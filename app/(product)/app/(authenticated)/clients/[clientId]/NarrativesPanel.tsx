"use client";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { saveNarrativeAction } from "../file-text-actions";
import { INPUT } from "./knowledge-ui";

// Org brain, phase 2: overview, background and our role, section 2 of the
// client file (claude/org-brain-spec-2026-10-12.md, 3.3). Each save is a
// new version; the old ones are listed under the text, so nothing is
// overwritten. The HTML comes from the server's markdown-lite renderer,
// which escapes everything first (see lib/markdown-lite.ts).

export type PanelNarrative = {
  kind: "OVERVIEW" | "BACKGROUND" | "OUR_ROLE";
  version: number;
  body: string;
  html: string;
  meta: string | null;
  history: { version: number; meta: string; html: string }[];
};

const TITLES: Record<PanelNarrative["kind"], { title: string; empty: string; placeholder: string }> = {
  OVERVIEW: { title: "סקירת הלקוח", empty: "עוד לא נכתבה סקירה.", placeholder: "חברה, סטארטאפ AI. שתי ישויות: Inc בארה\"ב ו-LTD בישראל. [S1 08:13]" },
  BACKGROUND: { title: "רקע", empty: "עוד לא נכתב רקע.", placeholder: "איך הגענו לכאן, מה היה לפנינו." },
  OUR_ROLE: { title: "התפקיד שלנו", empty: "עוד לא נכתב מה התפקיד שלנו.", placeholder: "HR, שכר וספקים. לא הנהלת חשבונות." },
};

function NarrativeForm({ clientId, n }: { clientId: string; n: PanelNarrative }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveNarrativeAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="kind" value={n.kind} />
      <input type="hidden" name="baseVersion" value={n.version} />
      <textarea name="body" rows={10} defaultValue={n.body} placeholder={TITLES[n.kind].placeholder} className={INPUT} />
      <p className="-mt-2 text-[11px] text-appNavy/40">מקורות בסוגריים, למשל [S1 08:13]. קוד שלא קיים במרשם נחסם. הגרסה הקודמת נשמרת.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "שמירת גרסה חדשה"}
      </button>
    </form>
  );
}

export function NarrativesPanel({ clientId, narratives }: { clientId: string; narratives: PanelNarrative[] }) {
  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <h2 className="text-sm font-medium text-appNavy">סקירה, רקע ותפקידנו</h2>
      <div className="mt-3 space-y-5">
        {narratives.map((n) => (
          <section key={n.kind}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-appNavy/60">
                {TITLES[n.kind].title}
                {n.meta && <span className="ms-2 font-normal text-appNavy/40">{n.meta}</span>}
              </h3>
              <Drawer triggerLabel={n.version ? "עריכה" : "כתיבה"} title={TITLES[n.kind].title} variant="link">
                <NarrativeForm clientId={clientId} n={n} />
              </Drawer>
            </div>
            {n.version ? (
              <div className="mt-1 text-sm leading-relaxed text-appNavy" dangerouslySetInnerHTML={{ __html: n.html }} />
            ) : (
              <p className="mt-1 text-sm text-appNavy/45">{TITLES[n.kind].empty}</p>
            )}
            {n.history.length > 0 && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-appNavy/45">גרסאות קודמות ({n.history.length})</summary>
                <ul className="mt-1.5 space-y-2">
                  {n.history.map((h) => (
                    <li key={h.version} className="text-xs text-appNavy/55">
                      <p className="text-[11px] text-appNavy/40">{h.meta}</p>
                      <div dangerouslySetInnerHTML={{ __html: h.html }} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
