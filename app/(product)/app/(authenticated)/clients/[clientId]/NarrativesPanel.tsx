"use client";
import { useTranslations } from "next-intl";
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


function NarrativeForm({ clientId, n }: { clientId: string; n: PanelNarrative }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(saveNarrativeAction, close);
  const t = useTranslations("clients.narratives");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="kind" value={n.kind} />
      <input type="hidden" name="baseVersion" value={n.version} />
      <textarea name="body" rows={10} defaultValue={n.body} placeholder={t(`kinds.${n.kind}.placeholder`)} dir="auto" className={INPUT} />
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("formHint")}</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("saveVersion")}
      </button>
    </form>
  );
}

export function NarrativesPanel({ clientId, narratives }: { clientId: string; narratives: PanelNarrative[] }) {
  const t = useTranslations("clients.narratives");
  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <h2 className="text-sm font-medium text-app-text-primary">{t("heading")}</h2>
      <div className="mt-3 space-y-5">
        {narratives.map((n) => (
          <section key={n.kind}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-app-text-secondary">
                {t(`kinds.${n.kind}.title`)}
                {n.meta && <span className="ms-2 font-normal text-app-text-tertiary">{n.meta}</span>}
              </h3>
              <Drawer triggerLabel={n.version ? t("edit") : t("write")} title={t(`kinds.${n.kind}.title`)} variant="link">
                <NarrativeForm clientId={clientId} n={n} />
              </Drawer>
            </div>
            {n.version ? (
              <div className="mt-1 text-sm leading-relaxed text-app-text-primary" dir="auto" dangerouslySetInnerHTML={{ __html: n.html }} />
            ) : (
              <p className="mt-1 text-sm text-app-text-tertiary">{t(`kinds.${n.kind}.empty`)}</p>
            )}
            {n.history.length > 0 && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-app-text-tertiary">{t("history", { count: n.history.length })}</summary>
                <ul className="mt-1.5 space-y-2">
                  {n.history.map((h) => (
                    <li key={h.version} className="text-xs text-app-text-secondary">
                      <p className="text-[11px] text-app-text-tertiary">{h.meta}</p>
                      <div dir="auto" dangerouslySetInnerHTML={{ __html: h.html }} />
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
