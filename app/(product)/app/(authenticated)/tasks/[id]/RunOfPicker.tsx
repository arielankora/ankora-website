"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setTaskProcessAction } from "./actions";

// "זו ריצה של..." (14.11.2026, processes redesign, stage 3, "Run.dc.html"):
// a task opened by hand, on a client with processes, can be marked as a run
// of one of them. A process whose name the task's title carries is offered
// first, to link in one press or to wave away.

export function RunOfPicker({ taskId, processes, suggested }: { taskId: string; processes: { id: string; code: string; title: string }[]; suggested: { id: string; code: string; title: string } | null }) {
  const t = useTranslations("tasks.detail.runOfPicker");
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link(processId: string) {
    setPending(true);
    setError(null);
    const r = await setTaskProcessAction({ taskId, processId });
    setPending(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-app-border bg-white px-[18px] py-3.5" data-testid="run-of-picker">
      <p className="text-[15px] text-app-text-primary">
        {t("question")}{" "}
        {!choosing && (
          <button type="button" onClick={() => setChoosing(true)} className="font-bold text-app-text-accent hover:underline">
            {t("choose")}
          </button>
        )}
      </p>
      {choosing && (
        <select aria-label={t("choose")} disabled={pending} defaultValue="" onChange={(e) => e.target.value && link(e.target.value)} className="w-full max-w-md rounded-[9px] border border-app-border bg-white px-3 py-2.5 text-[15px] text-app-text-primary">
          <option value="" disabled>
            {t("choose")}
          </option>
          {processes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} {p.title}
            </option>
          ))}
        </select>
      )}
      {suggested && !dismissed && !choosing && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] bg-app-surface-sunken px-3.5 py-2.5 text-sm" data-testid="run-of-suggestion">
          <span>
            {t("suggested")} <b>{`${suggested.code} ${suggested.title}`}</b>
          </span>
          <span className="flex gap-3">
            <button type="button" disabled={pending} onClick={() => link(suggested.id)} className="font-bold text-app-text-accent hover:underline">
              {t("link")}
            </button>
            <button type="button" onClick={() => setDismissed(true)} className="text-app-text-secondary hover:underline">
              {t("no")}
            </button>
          </span>
        </div>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
    </div>
  );
}
