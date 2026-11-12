"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { autoReviewAnchor } from "@/lib/approval-links";
import { useToast } from "@/components/app/toast/ToastProvider";
import { kindKeyLabel } from "./labels";
import { liftAutoApplyPauseAction, markAutoReviewedAction, revertProposalAction, setAutoApplyAction } from "./actions";

// "נכנס אוטומטית" (3.11.2026, approval tiers part 2): the items that
// entered a client file on arrival and still need a look, each with "תקין"
// and "ביטול"; and, for managers, the switch for all clients and the kinds
// and clients sent back to a person after too many errors.

export type AutoReviewRow = {
  id: string;
  clientName: string;
  /// lib/knowledge-review-filters.ts, proposalKindKey.
  kindKey: string;
  headline: string;
  /// The item in the client's file.
  itemHref: string | null;
  enteredAt: Date | null;
  /// Why a person looks at it (lib/auto-apply.ts, autoReviewReasonCode).
  why: { code: "firstDays"; days: number } | { code: "newGuide" } | { code: "sample"; percent: number };
};

export type AutoApplyPauseRow = {
  id: string;
  scope: "KIND" | "CLIENT";
  /// A kind's key, or null for a client.
  kindKey: string | null;
  /// A client's name, or null (a kind, or a client that is gone).
  clientName: string | null;
  /// Stored with the pause, in Hebrew, when it began (not yet coded).
  reason: string;
  since: Date;
  decisions: number;
  approvedAsIs: number;
  lowerBoundPct: number;
  barMet: boolean;
};

export type AutoApplyControls = { enabled: boolean; firstEnabled: Date | null; pauses: AutoApplyPauseRow[] };

/// A day, in the reader's time zone: these are moments, not dates.
const DAY_FORMAT = { day: "numeric", month: "numeric", year: "numeric" } as const;

function ReviewRow({ row }: { row: AutoReviewRow }) {
  const t = useTranslations("knowledge.auto");
  const tk = useTranslations("knowledge");
  const format = useFormatter();
  const { showToast } = useToast();
  const [pending, setPending] = useState<"ok" | "revert" | null>(null);
  const [asking, setAsking] = useState(false);
  async function run(kind: "ok" | "revert") {
    setPending(kind);
    const r = kind === "ok" ? await markAutoReviewedAction(row.id) : await revertProposalAction(row.id);
    setPending(null);
    setAsking(false);
    if (r.error) showToast({ tone: "error", title: kind === "ok" ? t("markFailed") : tk("revert.failed"), description: r.error });
    else showToast({ tone: "info", title: kind === "ok" ? t("marked") : tk("revert.done"), description: row.headline.slice(0, 80) });
  }
  const why = row.why.code === "firstDays" ? t("why.firstDays", { days: row.why.days }) : row.why.code === "newGuide" ? t("why.newGuide") : t("why.sample", { percent: row.why.percent });
  return (
    <li id={autoReviewAnchor(row.id)} className="flex flex-wrap items-start justify-between gap-3 py-3 scroll-mt-24 rounded-lg target:bg-app-accent-soft" data-testid="auto-review-row">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-app-text-primary" dir="auto">
          {row.headline}
        </p>
        <p className="mt-0.5 text-xs text-app-text-tertiary">
          <bdi>{row.clientName}</bdi> · {kindKeyLabel(tk, row.kindKey)} · {t("entered", { date: row.enteredAt ? format.dateTime(row.enteredAt, DAY_FORMAT) : "" })} · {why}
          {row.itemHref && (
            <>
              {" · "}
              <a href={row.itemHref} className="text-app-text-accent hover:underline">
                {t("toItem")}
              </a>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {asking ? (
          <>
            <span className="text-app-text-secondary">{tk("revert.confirm")}</span>
            <button type="button" disabled={!!pending} onClick={() => run("revert")} className="font-medium text-app-error disabled:opacity-50" data-testid="auto-review-revert-confirm">
              {pending === "revert" ? tk("revert.removing") : tk("revert.remove")}
            </button>
            <button type="button" disabled={!!pending} onClick={() => setAsking(false)} className="text-app-text-secondary">
              {tk("revert.keep")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!!pending}
              onClick={() => run("ok")}
              className="rounded-lg border border-app-border px-3 py-1 font-medium text-app-text-primary hover:border-app-accent disabled:opacity-50"
              data-testid="auto-review-ok"
            >
              {pending === "ok" ? t("marking") : t("ok")}
            </button>
            <button type="button" disabled={!!pending} onClick={() => setAsking(true)} className="px-2 py-1 text-app-text-accent hover:underline disabled:opacity-50" data-testid="auto-review-revert">
              {tk("revert.button")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Switch({ enabled, firstEnabled }: { enabled: boolean; firstEnabled: Date | null }) {
  const t = useTranslations("knowledge.auto");
  const format = useFormatter();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  async function flip() {
    setPending(true);
    const r = await setAutoApplyAction(!enabled);
    setPending(false);
    if (r.error) showToast({ tone: "error", title: t("switchFailed"), description: r.error });
    else showToast({ tone: "info", title: enabled ? t("switchedOff") : t("switchedOn") });
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-app-text-secondary">
        {t("switchLabel")} <span className={enabled ? "font-medium text-app-success" : "font-medium text-app-warning"}>{enabled ? t("on") : t("off")}</span>
        {firstEnabled && <span className="text-app-text-tertiary"> · {t("firstEnabled", { date: format.dateTime(firstEnabled, DAY_FORMAT) })}</span>}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={flip}
        className="rounded-lg border border-app-border px-3 py-1 text-xs font-medium text-app-text-primary hover:border-app-accent disabled:opacity-50"
        data-testid="auto-apply-switch"
      >
        {pending ? t("saving") : enabled ? t("turnOff") : t("turnOn")}
      </button>
    </div>
  );
}

function PauseRow({ p }: { p: AutoApplyPauseRow }) {
  const t = useTranslations("knowledge.auto");
  const tk = useTranslations("knowledge");
  const format = useFormatter();
  const { showToast } = useToast();
  const label = p.kindKey ? kindKeyLabel(tk, p.kindKey) : (p.clientName ?? t("clientFallback"));
  const [pending, setPending] = useState(false);
  async function lift() {
    setPending(true);
    const r = await liftAutoApplyPauseAction(p.id);
    setPending(false);
    if (r.error) showToast({ tone: "error", title: t("liftFailed"), description: r.error });
    else showToast({ tone: "info", title: t("lifted", { label }) });
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5" data-testid="auto-apply-pause">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-app-text-primary">
          {p.scope === "KIND" ? t("pauseKind") : t("pauseClient")} <bdi>{label}</bdi>
        </p>
        <p className="mt-0.5 text-xs text-app-text-tertiary">
          <bdi>{p.reason}</bdi> · {t("pausedSince", { date: format.dateTime(p.since, DAY_FORMAT) })}
        </p>
        <p className={`mt-0.5 text-xs ${p.barMet ? "text-app-success" : "text-app-text-secondary"}`}>
          {t("pauseBar", { decisions: p.decisions, approvedAsIs: p.approvedAsIs, lowerBound: p.lowerBoundPct })}
        </p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={lift}
        className="rounded-lg border border-app-border px-3 py-1 text-xs font-medium text-app-text-primary hover:border-app-accent disabled:opacity-50"
        data-testid="auto-apply-lift"
      >
        {pending ? t("lifting") : t("lift")}
      </button>
    </li>
  );
}

export function AutoApplied({ rows, controls }: { rows: AutoReviewRow[]; controls: AutoApplyControls | null }) {
  const t = useTranslations("knowledge.auto");
  if (rows.length === 0 && !controls) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-app-border bg-white px-5 py-4" data-testid="auto-applied">
      <div>
        <h2 className="text-sm font-medium text-app-text-primary">{rows.length > 0 ? t("titleCount", { count: rows.length }) : t("title")}</h2>
        <p className="mt-1 text-xs text-app-text-secondary">{t("intro")}</p>
      </div>
      {controls && <Switch enabled={controls.enabled} firstEnabled={controls.firstEnabled} />}
      {controls && controls.pauses.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-app-text-primary">{t("pausesTitle")}</h3>
          <ul className="divide-y divide-app-border">
            {controls.pauses.map((p) => (
              <PauseRow key={p.id} p={p} />
            ))}
          </ul>
        </div>
      )}
      {rows.length > 0 ? (
        <ul className="divide-y divide-app-border">
          {rows.map((r) => (
            <ReviewRow key={r.id} row={r} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-app-text-tertiary">{t("empty")}</p>
      )}
    </section>
  );
}
